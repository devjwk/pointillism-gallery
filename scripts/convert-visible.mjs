// Reproducible visible-surface export from local RGB/depth data. No model/API network call.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createVisibleSurface} from '../tools/scene-validation/src/geometry/visible-surface.js';
const args={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!k?.startsWith('--')||v===undefined)throw new Error('Use --input depth-rgb.json --output output.scene.json [--source photo.jpg]');args[k.slice(2)]=v;}
if(!args.input||!args.output)throw new Error('--input and --output required.');
try{await fs.access(args.output);throw new Error('Output already exists; choose a new run path.');}catch(e){if(e.code!=='ENOENT')throw e;}
const input=JSON.parse(await fs.readFile(args.input,'utf8'));
const {scene,statistics}=createVisibleSurface(input,{maxSide:Number(args['max-side']||256),budget:Number(args.budget||8000),seed:Number(args.seed||42)});
if(args.source){scene.conversion.sourceName=path.basename(args.source);scene.conversion.sourceSha256=createHash('sha256').update(await fs.readFile(args.source)).digest('hex');}
await fs.mkdir(path.dirname(path.resolve(args.output)),{recursive:true});await fs.writeFile(args.output,JSON.stringify(scene));
console.log(JSON.stringify({output:args.output,completionScope:scene.completion_scope,synthetic:scene.synthetic,statistics},null,2));
