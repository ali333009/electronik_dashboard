const fs = require('fs');
const iconv = require('iconv-lite');

const corrupted = fs.readFileSync('app.js', 'utf8');
const originalBytes = iconv.encode(corrupted, 'windows-1256');
const fixedString = originalBytes.toString('utf8');
fs.writeFileSync('app.js', fixedString, 'utf8');
console.log('Fixed encoding!');
