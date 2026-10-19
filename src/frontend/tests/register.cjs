const fs = require('node:fs');
const ts = require('typescript');
for (const suffix of ['.ts', '.tsx']) require.extensions[suffix] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
  });
  module._compile(output.outputText, file);
};
require.extensions['.css'] = (module) => { module.exports = new Proxy({}, { get: (_, name) => String(name) }); };
