let expect = require('chai').expect;
let commonjs = require('../index');
let rollup = require('rollup');

async function generateImpl (files, options) {
    let bundle = await rollup.rollup({
        input: './__entry.js',
        plugins: [
            {
                resolveId (id) {
                    return id;
                },
                load (id) {
                    if (files[id]) {
                        return files[id];
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

async function generate (files, options) {
    let { output } = await generateImpl(files, options);
    return eval('(function() {' + output[0].code.replace('export default', 'return') + '})()');
}

async function generateBundle (files, options) {
    return (await generateImpl(files, options)).output[0];
}

describe('Rollup Plugin CommonJS Alternate', () => {
    describe('Exporting to entry', () => {
        it ('CJS exports default primitive', async () => {
            let output = await generate({
                './main.js': 'module.exports = 123'
            });

            expect(output.default).to.equal(123);
        });

        it ('CJS exports default object', async () => {
            let output = await generate({
                './main.js': 'module.exports = {};'
            });

            expect(output.default).to.deep.equal({});
        });

        it ('CJS exports default primitive in ESM', async () => {
            let output = await generate({
                './main.js': `
                    Object.defineProperty(exports, '__esModule', { get () { return true } });
                    exports.default = 123;
                `
            });

            expect(output.default).to.equal(123);
        });

        it ('CJS export variable', async () => {
            let output = await generate({
                './main.js': `
                    var MyLib = {};
                    module.exports = MyLib;
                `
            });

            expect(output.default).to.deep.equal({});
        });

        it ('CJS export ESM with multiple named exports', async () => {
            let output = await generate({
                './main.js': `
                    Object.defineProperty(exports, '__esModule', { get () { return true } });
                    exports.default = 123;
                    exports.message = 'hello world';
                `
            });

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
            });

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
            });

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
            });

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
            });

            expect(output.Message()).to.equal('hello world');
        });

        it ('Does nothing with module.hot', async () => {
            let output = await generate({
                './main.js': `
                    module.hot && module.hot.accept();
                    module.exports = 123;
                `
            });

            expect(output.default).to.equal(123);
            expect(output.hot).to.be.undefined;
            expect(output.accept).to.be.undefined; 
        });

        it ('CJS exports supports using string to access exports property', async () => {
            let output = await generate({
                './main.js': 'module[\'exports\'] = 123'
            });

            expect(output.default).to.equal(123);
        });

        it ('Can still export even with comment at the end', async () => {
            let output = await generate({
                './main.js': 'module.exports = 123; // Comment'
            });

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
            });

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
            });

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
            });

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
            });

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
            });

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
            });

            expect(output.default).to.equal(123);
        });

        it ('should not do anything with require calls without literals', async () => {
            let output = await generate({
                './main.js': `
                    var dep = () => require(somevar);
                    module.exports = dep;
                `
            });

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
            });

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
            });

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
            });

            expect(output.code.indexOf('123') > -1).to.be.false;
            expect(output.code.indexOf('456') > -1).to.be.true;
        });
    });
});