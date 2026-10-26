// Browser converter (src/s3d.js) against convert.py for all 22 levels. node parity.js [vscale]
// First: for i in $(seq 22); do python3 convert.py rom/s3d.bin $i 1 > out/lv${i}_1.json; done   (vscale 1; 0.5 for half)
const fs=require('fs'),vm=require('vm');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'src', 's3d.js'),'utf8')+'\nthis.S3D=S3D;',ctx);
const S3D=ctx.S3D, rom=new Uint8Array(fs.readFileSync('rom/s3d.bin'));
console.log('check:', S3D.check(rom));
const bad=rom.slice(); bad[0x300]^=1; console.log('check damaged:', S3D.check(bad));
console.log('check tiny:', S3D.check(new Uint8Array(100)));
const VS=Number(process.argv[2]||1);
let same=0;
for(let i=1;i<=22;i++){
  const js=S3D.convert(rom,i,VS), py=JSON.parse(fs.readFileSync(`out/lv${i}_${VS}.json`));
  const pick=o=>JSON.stringify([o.tiles,o.entities,o.physics,o.rom,o.killY,o.flickies]);
  const t1=pick(js), t2=pick(py);
  const ok = t1===t2 && js.width===py.width && js.depth===py.depth;
  same+=ok;
  if(!ok){ console.log('MISMATCH',i); for(let k=0;k<Math.max(js.entities.length,py.entities.length);k++){ if(JSON.stringify(js.entities[k])!==JSON.stringify(py.entities[k])){ console.log(' first diff',k,JSON.stringify(js.entities[k]),JSON.stringify(py.entities[k])); break; } } }
}
console.log('tiles and entities identical to Python reference for',same,'of 22 levels');
const t0=Date.now(); for(let i=1;i<=22;i++) S3D.convert(rom,i); console.log('all 22 converted in',Date.now()-t0,'ms');
