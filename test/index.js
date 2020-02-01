let expect = require('chai').expect;
let commonjs = require('../index');
let rollup = require('rollup');
let nollup = require('nollup');
let path = require('path');

async function generateImpl (files, options, engine) {
    let resolved_files = {};

    for (let key in files) {
        resolved_files[path.resolve(process.cwd(), key)] = files[key];
    }

    let bundle = await engine({
        input: './__entry.js',
        plugins: [
            {
                resolveId (id) {
                    return path.resolve(process.cwd(), id);
                },
                load (id) {
                    if (resolved_files[id]) {
                        return resolved_files[id];
                    }
                    return 'import * as main from \'./main.js\'; export default main;'
                }
            },
            commonjs(options)
        ]
    });

    let response = await bundle.generate({ format: 'esm' });
    return response;
}

async function generate (files, options, engine) {
    let { output } = await generateImpl(files, options, engine);
    return eval('(function() {' + output[0].code.replace('export default', 'return') + '})()');
}

async function generateBundle (files, options, engine) {
    return (await generateImpl(files, options, engine)).output[0];
}

describe('Rollup Plugin CommonJS Alternate', () => {
    [{
        title: 'Rollup',
        engine: rollup.rollup
    }, {
        title: 'Nollup',
        engine: nollup
    }].forEach(entry => {
        describe(entry.title, () => {
            describe('Exporting to entry', () => {
                it ('CJS exports default primitive', async () => {
                    let output = await generate({
                        './main.js': 'module.exports = 123'
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('CJS exports default object', async () => {
                    let output = await generate({
                        './main.js': 'module.exports = {};'
                    }, {}, entry.engine);

                    expect(output.default).to.deep.equal({});
                });

                it ('CJS exports default primitive in ESM', async () => {
                    let output = await generate({
                        './main.js': `
                            Object.defineProperty(exports, '__esModule', { get () { return true } });
                            exports.default = 123;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('CJS export variable', async () => {
                    let output = await generate({
                        './main.js': `
                            var MyLib = {};
                            module.exports = MyLib;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.deep.equal({});
                });

                it ('CJS export ESM with multiple named exports', async () => {
                    let output = await generate({
                        './main.js': `
                            Object.defineProperty(exports, '__esModule', { get () { return true } });
                            exports.default = 123;
                            exports.message = 'hello world';
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                    expect(output.message).to.equal('hello world');
                });

                it ('CJS export ESM with multiple named exports (exports.__esModule)', async () => {
                    let output = await generate({
                        './main.js': `
                            exports.__esModule = true;
                            exports.default = 123;
                            exports.message = 'hello world';
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                    expect(output.message).to.equal('hello world');
                });

                 it ('CJS export ESM with multiple named exports (module.exports.__esModule)', async () => {
                    let output = await generate({
                        './main.js': `
                            module.exports.__esModule = true;
                            exports.default = 123;
                            exports.message = 'hello world';
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                    expect(output.message).to.equal('hello world');
                });

                it ('CJS with named exports inside variable', async () => {
                    let output = await generate({
                        './main.js': `
                            var MyLib = { message: 'hello world' };
                            module.exports = MyLib;
                        `
                    }, {
                        namedExports: {
                            '/main.js': ['message']
                        }
                    }, entry.engine);

                    expect(output.message).to.equal('hello world');
                });

                it ('CJS with named exports top level - variable declaration', async () => {
                    let output = await generate({
                        './main.js': `
                            const message = 'hello world';
                            var MyLib = { message };
                            module.exports = MyLib;
                        `
                    }, {
                        namedExports: {
                            '/main.js': ['message']
                        }
                    }, entry.engine);

                    expect(output.message).to.equal('hello world');
                });

                it ('CJS with named exports top level - class', async () => {
                    let output = await generate({
                        './main.js': `
                            class SomethingElse {};
                            class Message { getMessage () { return 'hello world' } };
                            var MyLib = { Message };
                            module.exports = MyLib;
                        `
                    }, {
                        namedExports: {
                            '/main.js': ['Message']
                        }
                    }, entry.engine);

                    expect(new output.Message().getMessage()).to.equal('hello world');
                });

                it ('CJS with named exports top level - function', async () => {
                    let output = await generate({
                        './main.js': `
                            function SomethingElse () {}
                            function Message () {
                                return 'hello world';
                            };
                            var MyLib = { Message };
                            module.exports = MyLib;
                        `
                    }, {
                        namedExports: {
                            '/main.js': ['Message']
                        }
                    }, entry.engine);

                    expect(output.Message()).to.equal('hello world');
                });

                it ('Does nothing with module.hot', async () => {
                    let output = await generate({
                        './main.js': `
                            module.hot && module.hot.accept();
                            module.exports = 123;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                    expect(output.hot).to.be.undefined;
                    expect(output.accept).to.be.undefined; 
                });

                it ('CJS exports supports using string to access exports property', async () => {
                    let output = await generate({
                        './main.js': 'module[\'exports\'] = 123'
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('Can still export even with comment at the end', async () => {
                    let output = await generate({
                        './main.js': 'module.exports = 123; // Comment'
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('Supports UMD style exports', async () => {
                    let output = await generate({
                        './main.js': `
                            (function (factory) {
                                if (typeof exports !== 'undefined') {
                                    factory(exports);
                                }
                            })(function (output) {
                                output.hello = 'world';
                            });
                        `
                    }, {}, entry.engine);

                    expect(output.default.hello).to.equal('world');
                });

                it ('Does not export default if it is already there', async () => {
                    let output = await generate({
                        './main.js': `
                            if (typeof exports !== 'undefined') {
                                console.log(exports);
                            }

                            export default 123;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('Does not export default if it is already there (__esModule)', async () => {
                    let output = await generate({
                        './main.js': `
                            Object.defineProperty(exports, '__esModule', { get () { return true } });

                            if (typeof exports !== 'undefined') {
                                console.log(exports);
                            }

                            export default 123;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });
            })

            describe('Importing inside CJS', () => {
                it ('Import CJS module', async () => {
                    let output = await generate({
                        './dep.js': `
                            module.exports = 123;
                        `,
                        './main.js': `
                            var dep = require('./dep.js');
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('Import CJS module with object exported', async () => {
                    let output = await generate({
                        './dep.js': `
                            module.exports = {
                                message: 'hello'
                            };
                        `,
                        './main.js': `
                            var dep = require('./dep.js');
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default.message).to.equal('hello');
                });

                it ('Import ESM module with no default', async () => {
                    let output = await generate({
                        './dep.js': `
                            var message = 'hello';
                            export { message };
                        `,
                        './main.js': `
                            var dep = require('./dep.js');
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default.message).to.equal('hello');
                });

                it ('Import transpiled ESM module with no default', async () => {
                    let output = await generate({
                        './dep.js': `
                            Object.defineProperty(exports, '__esModule', { get () { return true } });
                            exports.message = 'hello';
                        `,
                        './main.js': `
                            var dep = require('./dep.js');
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default.message).to.equal('hello');
                });

                it ('Import CJS with default set to false (issue #1)', async () => {
                    let output = await generate({
                        './dep.js': `
                            module.exports = false;
                        `,
                        './main.js': `
                            var dep = require('./dep.js');
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(false);
                });
            });

            describe('Require', () => {
                it ('should handle nested requires and exports', async () => {
                    let output = await generate({
                        './dep.js': `
                            (() => module.exports = 123)();
                        `,
                        './main.js': `
                            var dep = () => require('./dep.js');
                            module.exports = dep();
                        `
                    }, {}, entry.engine);

                    expect(output.default).to.equal(123);
                });

                it ('should not do anything with require calls without literals', async () => {
                    let output = await generate({
                        './main.js': `
                            var dep = () => require(somevar);
                            module.exports = dep;
                        `
                    }, {}, entry.engine);

                    expect(output.default.toString()).to.equal('() => require(somevar)');
                });
            });

            describe('Conditional Require', () => {
                it ('should not include anything if branch fails', async () => {
                    let output = await generateBundle({
                        './dep1.js': `module.exports = 123`,
                        './dep2.js': `module.exports = 456`,
                        './main.js': `
                            if (1 == 2) {
                                module.exports = require('./dep1.js');
                            }

                            if (1 == 2) {
                                module.exports = require('./dep2.js');
                            }
                        `
                    }, {}, entry.engine);

                    expect(output.code.indexOf('123') > -1).to.be.false;
                    expect(output.code.indexOf('456') > -1).to.be.false;
                });

                it ('should include if branch passes', async () => {
                    let output = await generateBundle({
                        './dep1.js': `module.exports = 123`,
                        './dep2.js': `module.exports = 456`,
                        './main.js': `
                            if (1 == 1) {
                                module.exports = require('./dep1.js');
                            }

                            if (1 == 2) {
                                module.exports = require('./dep2.js');
                            }
                        `
                    }, {}, entry.engine);

                    expect(output.code.indexOf('123') > -1).to.be.true;
                    expect(output.code.indexOf('456') > -1).to.be.false;
                });

                it ('should include if branch passes - else', async () => {
                    let output = await generateBundle({
                        './dep1.js': `module.exports = 123`,
                        './dep2.js': `module.exports = 456`,
                        './main.js': `
                            if (1 == 2) {
                                module.exports = require('./dep1.js');
                            } else {
                                module.exports = require('./dep2.js');
                            }
                        `
                    }, {}, entry.engine);

                    expect(output.code.indexOf('123') > -1).to.be.false;
                    expect(output.code.indexOf('456') > -1).to.be.true;
                });
            });

            describe('Synthetic Named Exports', () => {
                it ('CJS with synthetic named exports top level - variable declaration', async () => {
                    let output = await generate({
                        './main.js': `
                            const message = 'hello world';
                            var MyLib = { message };
                            module.exports = MyLib;
                        `
                    }, {}, entry.engine);

                    expect(output.message).to.equal('hello world');
                });

                it ('CJS with synthetic named exports top level - class', async () => {
                    let output = await generate({
                        './main.js': `
                            class SomethingElse {};
                            class Message { getMessage () { return 'hello world' } };
                            var MyLib = { Message };
                            module.exports = MyLib;
                        `
                    }, {}, entry.engine);

                    expect(new output.Message().getMessage()).to.equal('hello world');
                });
            });

            describe ('Options: extensions', () => {
                it ('should allow to specify additional extensions for transforming', async () => {
                    let output = await generate({
                        './main.js': `
                            import dep from './dep.jsx';
                            export default dep;
                        `,
                        './dep.jsx': `
                            module.exports = 'hello';
                        `
                    }, {
                        extensions: ['.js', '.jsx']
                    }, entry.engine);

                    expect(output.default).to.equal('hello');
                });
            });

            describe('Miscellanous Issues', () => {
                it ('assigning module.exports to exports', async () => {
                    let output = await generate({
                        './main.js': `
                            "use strict";

                            Object.defineProperty(exports, "__esModule", {
                              value: true
                            });
                            exports.default = getMessage;


                            function getMessage() {
                              return 'hello world';
                            }

                            module.exports = exports.default;
                            module.exports.default = exports.default;
                        `
                    }, {}, entry.engine);

                    expect(output.default()).to.equal('hello world');
                })
            })
        });
    });
            
});