'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function loadLocalMapEnv(root, env = process.env) {
  let values;
  try { values = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw new Error('Local map configuration could not be read'); }
  for (const key of ['VWORLD_API_KEY', 'VWORLD_DOMAIN', 'VWORLD_API_DOMAIN', 'BSO_QGIS_ROOT', 'BSO_QGIS_PYTHON', 'BSO_GRAPHICS_CADASTRAL_ARCHIVE', 'BSO_GRAPHICS_CRS']) {
    if (env[key] === undefined && values[key] !== undefined) env[key] = values[key];
  }
  if (!env.VWORLD_DOMAIN && env.VWORLD_API_DOMAIN) env.VWORLD_DOMAIN = env.VWORLD_API_DOMAIN;
}
function directories(root) {
  try { return fs.readdirSync(root, { withFileTypes:true }).filter(x => x.isDirectory()).map(x => x.name); }
  catch (_) { return []; }
}
function windowsQgisCandidates(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return [];
  const roots = env.BSO_QGIS_ROOT ? [env.BSO_QGIS_ROOT] : [];
  for (const base of [env.ProgramFiles, env['ProgramW6432']].filter(Boolean)) {
    for (const name of directories(base).filter(x => /^QGIS \d/.test(x)).sort((a,b) => b.localeCompare(a, undefined, {numeric:true}))) roots.push(path.join(base,name));
  }
  const results = [];
  for (const root of [...new Set(roots)]) {
    const apps = path.join(root,'apps');
    const qgisName = ['qgis-ltr','qgis'].find(name => fs.existsSync(path.join(apps,name,'python','qgis','__init__.py')));
    const pythonName = directories(apps).filter(name => /^Python3\d+$/.test(name)).sort((a,b) => b.localeCompare(a, undefined, {numeric:true}))[0];
    const command = path.join(root,'bin','python3.exe');
    if (!qgisName || !pythonName || !fs.existsSync(command)) continue;
    const qgis = path.join(apps,qgisName);
    const qt = ['Qt5','Qt6'].map(name => path.join(apps,name)).find(dir => fs.existsSync(path.join(dir,'bin')));
    if (!qt) continue;
    const childEnv = {...env};
    // Windows environment names are case insensitive; avoid competing PATH spellings.
    for (const key of Object.keys(childEnv)) if (key.toUpperCase() === 'PATH') delete childEnv[key];
    const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
    Object.assign(childEnv, {
      OSGEO4W_ROOT:root,
      PATH:[path.join(qgis,'bin'),path.join(qt,'bin'),path.join(apps,pythonName,'Scripts'),path.join(root,'bin'),path.join(systemRoot,'System32'),systemRoot].join(';'),
      PYTHONHOME:path.join(apps,pythonName),
      PYTHONPATH:path.join(qgis,'python'),
      PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8',
      QGIS_PREFIX_PATH:qgis.replace(/\\/g,'/'),
      QT_PLUGIN_PATH:[path.join(qgis,'qtplugins'),path.join(qt,'plugins')].join(';'),
      QT_QPA_PLATFORM:env.QT_QPA_PLATFORM || 'windows',
      GDAL_DATA:path.join(apps,'gdal','share','gdal'),
      GDAL_DRIVER_PATH:path.join(apps,'gdal','lib','gdalplugins'),
      PROJ_DATA:path.join(root,'share','proj'),
      SSL_CERT_FILE:path.join(root,'bin','curl-ca-bundle.crt'),
      GDAL_FILENAME_IS_UTF8:'YES',
    });
    results.push({command,args:[],env:childEnv});
  }
  return results;
}
module.exports = {loadLocalMapEnv, windowsQgisCandidates};
