const path=require('node:path');
const root=path.resolve(__dirname,'..');
const esbuild=require(path.join(root,'vendor/paperclip/node_modules/esbuild'));
esbuild.buildSync({entryPoints:[path.join(__dirname,'ui.tsx')],bundle:true,outfile:path.join(__dirname,'dist/app.js'),jsx:'automatic',nodePaths:[path.join(root,'vendor/paperclip/ui/node_modules')],define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'});
