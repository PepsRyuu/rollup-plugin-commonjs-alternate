let path = require('path');
let estree = require('estree-walker');
let MagicString = require('magic-string');
let astring = require('astring');

function findTopLevelDeclaration (ast, name) {
    return ast.body.some(node => {
        if (node.type === 'VariableDeclaration') {
            if (node.declarations.find(d => d.id.name === name)) {
                return true;
            }
        }

        if (node.type === 'FunctionDeclaration') {
            if (node.id.name === name) {
                return true;
            }
        }

        if (node.type === 'ClassDeclaration') {
            if (node.id.name === name) {
                return true;
            }
        }
    });
}

function findNodeInAst (ast, target) {
    let found;

    estree.walk(ast, {
        enter (node) {
            if (node === target) {
                found = true;
            }
        }
    });

    return found;
}


module.exports = function (options) {
    return {
        transform: function (code, id) {
            if (path.extname(id) !== '.js') {
                return;
            }

            let importIndex = 0;
            let hasExports = false;
            let hasImports = false;
            
            let s = new MagicString(code);
            let ast = this.parse(code);
            
            let ancestors = [];
            estree.walk(ast, {
                enter: (node, parent) => {
                    s.addSourcemapLocation(node.start);
                    s.addSourcemapLocation(node.end);

                    if (node.type === 'CallExpression') {
                        // Each time we find a require call, we add an import statement to the top.
                        // The closest thing in ESM we can map require to is the following:
                        //
                        //     var MyFile = require('myfile') --> import * as __temp from 'myfile';
                        //
                        // We use this syntax because this will make sure that we're not looking for a default property.
                        // The require calls are then replaced with the __temp variable.
                        //
                        if (node.callee.name === 'require') {
                            if (node.arguments.length === 1 && node.arguments[0].type === 'Literal') {   

                                // Before we automatically add the import statement, we need to see 
                                // if this module should be included. This is important because of 
                                // conditional requires that use stuff like process.env to determine
                                // which module should be loaded.                        
                                let shouldInclude = true;

                                ancestors.some((parent, index) => {
                                    // TODO: Temporary workaround for RHL, because if has a condition
                                    // which can't be easily statically parsed and cannot be executed.
                                    //
                                    // --> if (!module.hot || process.env.NODE_ENV === 'production' || !platformSupported)
                                    // 
                                    // Not entirely sure how to parse this.
                                    // 
                                    if (parent.type === 'IfStatement' && parent.test.type === 'BinaryExpression') {
                                        shouldInclude = false;

                                        // This is a bit of a hack, but it works for the time being.
                                        // We temporarily swap out the implementation of the if statement
                                        // and execute the if statement and see which branch was activated.
                                        let branch;
                                        let consequent = parent.consequent;
                                        let alternate = parent.alternate;
                                        parent.consequent = this.parse('branch = 0');
                                        parent.alternate = this.parse('branch = 1');

                                        branch = eval(`
                                            (function () {
                                                var branch;
                                                ${astring.generate(parent)}
                                                return branch;
                                            })();
                                        `);

                                        parent.consequent = consequent;
                                        parent.alternate = alternate;

                                        // Once we know which branch executed, we'll see if this require
                                        // call is inside that branch. If it is, import this module, else do nothing.
                                        let branchToCheck = branch === 0? consequent : alternate;
                                        // let found = walk.findNodeAt(branchToCheck, node.start, node.end, (type, n) => {
                                        //     return n === node;
                                        // });

                                        let found = findNodeInAst(branchToCheck, node);

                                        if (found) {
                                            shouldInclude = true;
                                        }

                                        return true;
                                    }
                                });

                                if (shouldInclude) {
                                    let importee = node.arguments[0].value;
                                    let tempImportName = '__require__import__' + (importIndex++);
                                    s.overwrite(node.start, node.end, `__interopImport(${tempImportName})`);
                                    s.prepend(`import * as ${tempImportName} from '${importee}';`);
                                    hasImports = true;
                                }

                            }
                        }
                    }

                    if (node.type === 'AssignmentExpression') {
                        // Convert module.export calls to __exports.
                        // __exports is then exported as the default at the end.
                        // module.exports isn't necessarily on the top level and can be inside
                        // branches, so that's why we use a custom object instead.
                        let left = node.left;
                        if (left.type === 'MemberExpression') {
                            if (left.object && left.object.name === 'module') {
                                if (left.property && left.property.name === 'exports') {
                                    hasExports = true;
                                    s.overwrite(left.object.start, left.property.end, '__exports');
                                }
                            }

                            if (left.object && left.object.name === 'exports') {
                                hasExports = true;
                                s.overwrite(left.object.start, left.object.end, '__exports');
                            }
                        }
                    }

                    // object.define(exports) and a(export.method)
                    if (node.type === 'Identifier' && node.name === 'exports') {
                        if (!parent.object || parent.object === node) {
                            s.overwrite(node.start, node.end, '__exports');
                        } 
                    }

                    ancestors.push(node);
                },

                leave: (node, parent) => {
                    ancestors.pop();
                }

            });

            // Because we're exporting a default object, anything that calls require
            // needs to get that default export. We're using default export because 
            // it allows us to output arbitrary variables.
            //
            // However, another situation can come up. What if you require an ES module?
            // If you do, it won't necessarily have a default export. Therefore as a fallback,
            // we return the full module instead of just its default. 
            if (hasImports) {
                s.prepend(`
                    function __interopImport(ex) {
                        if (ex.default) {
                            return ex.default;
                        } else {
                            return ex;
                        }
                    }
                `)
            }


            // We use default exports because it allows us to export arbitrary code.
            //
            //    module.exports = 'abc';
            //
            // In this example, there's no way to know what to call that export. 
            // With default exports, we don't need to know.
            if (hasExports) {
                s.prepend('var __exports = {};');
                s.append('export default __exports;')

                // Because module.exports is dynamic and allows for arbitrary assignments, everything must 
                // be assigned to default. But that also means named exports don't work because everything
                // is attached to the default export.
                // 
                // To solve this problem, we have to manually specify in the options configuration
                // what files should export what objects. We create an explicit export statement for 
                // each one at the bottom of the file.
                let namedExportFile = id.replace(process.cwd(), '').replace(/\\/g, '/').substring(1);
                if (options.namedExports && options.namedExports[namedExportFile]) {
                    let names = options.namedExports[namedExportFile];

                    let topLevelNames = names.filter(name => findTopLevelDeclaration(ast, name));
                    let otherNames = names.filter(name => topLevelNames.indexOf(name) === -1);

                    if (topLevelNames.length > 0) {
                        s.append(`
                            export { ${topLevelNames.join(', ')} };
                        `);
                    }

                    if (otherNames.length > 0) {
                        s.append(`
                            ${otherNames.map(ex => {
                                return `export var ${ex} = __exports.${ex};`;
                            }).join(' ')}
                        `);
                    }
                }
            }

            return {
                code: s.toString(),
                map: s.generateMap({ source: id })
            };
        }
    }
}
