const fs = require('fs');
const b64 = f => fs.readFileSync(f).toString('base64');
let html = fs.readFileSync('app_template.html','utf8');
html = html.replace('/*XLSX_LIB*/', ()=>fs.readFileSync('node_modules/xlsx-js-style/dist/xlsx.bundle.js','utf8'));
html = html.replace('/*PAKO_LIB*/', ()=>fs.readFileSync('node_modules/pako/dist/browser/pako_inflate.umd.min.js','utf8'));
html = html.replace('/*TESSERACT_LIB*/', ()=>fs.readFileSync('node_modules/tesseract.js/dist/tesseract.min.js','utf8'));
html = html.replace('/*OCR_ASSETS*/', ()=>'const AK_OCR_B64={worker:"'+b64('node_modules/tesseract.js/dist/worker.min.js')
  +'",core:"'+b64('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js')
  +'",kor:"'+b64('node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz')
  +'",eng:"'+b64('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')+'"};');
html = html.replace('/*PARSER_LIB*/', ()=>fs.readFileSync('parser.js','utf8'));
html = html.replace('/*EXTRACT_LIB*/', ()=>fs.readFileSync('extract.js','utf8'));
fs.writeFileSync('아꼼이네_주문정리기.html', html);
console.log('OK size:', (fs.statSync('아꼼이네_주문정리기.html').size/1048576).toFixed(1)+'MB');
