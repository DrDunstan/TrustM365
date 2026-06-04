const fs = require('fs');
const path = require('path');

module.exports.write = function(template, outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = path.join(outDir, template.template_id + '.json');
  fs.writeFileSync(filename, JSON.stringify(template, null, 2), 'utf8');
  return filename;
};
