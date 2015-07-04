/*
 * self.js
 * Copyright (C) 2015 Kovid Goyal <kovid at kovidgoyal.net>
 *
 * Distributed under terms of the BSD license.
 */
"use strict;";

var path = require('path');
var crypto = require('crypto');
var fs = require('fs');
var RapydScript = require('./compiler');

function compile_once(base_path, src_path, lib_path, start_time) {
    var output_options = {'beautify': true, 'private_scope': false, 'omit_baselib': true, 'write_name': false};
	var baselib = RapydScript.parse_baselib(src_path, true);
    var count = 0;

    function timed(name, cont) {
        var t1 = new Date().getTime();
        console.log('Compiling', name, '...');
        var ret = cont();
        console.log('Compiled in', (new Date().getTime() - t1)/1000, 'seconds\n');
        count++;
        return ret;
    }

	function parse_file(code, file) {
		return RapydScript.parse(code, {
			filename: file,
			basedir: path.dirname(file),
			auto_bind: false,
			libdir: path.join(src_path, 'lib'),
		});
	}

    var saved_hashes = {}, hashes = {}, compiled = {};
    var compiler_changed = false, sha1sum;
    var signatures = path.join(lib_path, 'signatures.json');
    try {
        saved_hashes = JSON.parse(fs.readFileSync(signatures, 'utf-8'));
    } catch (e) {
        if (e.code != 'ENOENT') throw (e);
    }

    sha1sum = crypto.createHash('sha1');
    RapydScript.FILES.concat([module.filename, path.join(base_path, 'tools', 'compiler.js')]).forEach(function (fpath) {
        sha1sum.update(fs.readFileSync(fpath));
    });
    hashes['#compiler#'] = sha1sum.digest('hex');
    source_hash = crypto.createHash('sha1');
    sources = {};
    RapydScript.FILENAMES.forEach(function (fname) {
        var src = path.join(src_path, fname + '.pyj');
        var h = crypto.createHash('sha1');
        var raw = fs.readFileSync(src, 'utf-8');
        sources[src] = raw;
        source_hash.update(raw);
        h.update(raw);
        hashes[fname] = h.digest('hex');
    });
    source_hash = source_hash.digest('hex');
    compiler_changed = (hashes['#compiler#'] != saved_hashes['#compiler#']) ? true : false;
    function changed(name) {
        return compiler_changed || hashes[name] != saved_hashes[name];
    }

    function generate_baselib() {
        var output = '';
        Object.keys(baselib).forEach(function(key) {
            output += String(baselib[key]) + '\n\n';
        });
        return output;
    }

    if (changed('baselib')) compiled.baselib = timed('baselib', generate_baselib);
    RapydScript.FILENAMES.slice(1).forEach(function (fname) {
        if (changed(fname)) {
            var src = path.join(src_path, fname + '.pyj');
            timed(fname, function() {
                var raw = sources[src];
                if (fname === 'parse')
                    raw = raw.replace('__COMPILER_VERSION__', source_hash);
                var toplevel = parse_file(raw, src);
                var output = RapydScript.OutputStream(output_options);
                toplevel.print(output);
                compiled[fname] = output.get();
            });
        }
    });
    if (count) {
        console.log('Compiling RapydScript succeeded (', (new Date().getTime() - start_time)/1000, 'seconds ), writing output...');
        Object.keys(compiled).forEach(function (fname) {
            fs.writeFileSync(path.join(lib_path, fname + '.js'), compiled[fname], "utf8");
        });
        fs.writeFileSync(signatures, JSON.stringify(hashes, null, 4));
    } else {
        console.log('Compilation not needed, nothing is changed');
    }
    return count;
}

module.exports = function compile_self(base_path, src_path, lib_path, start_time, complete) {
    var count;
    do {
        count = compile_once(base_path, src_path, lib_path, start_time);
        if (RapydScript.reset_index_counter) RapydScript.reset_index_counter();
    } while (count > 0 && complete);
};
