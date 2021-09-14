import { KML } from '../../src/og/layer/KML.js';

const osm = new og.layer.XYZ('osm', { isBaseLayer: true, url: '//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' });
const globus = new og.Globe({ target: 'globus', terrain: new og.terrain.GlobusTerrain(), layers: [osm] });

let dieppeRouen;

document.getElementById('upload').onchange = async e => {
  const color = document.getElementById('color').value;
  dieppeRouen.setColor(color);
  dieppeRouen.addKmlFromFiles(Array.from(e.target.files));
  globus.planet.flyExtent(dieppeRouen.getExtent());
  document.getElementById('viewExtent').style.display = 'inline';
};

document.getElementById('viewExtent').onclick = () => {
  globus.planet.flyExtent(dieppeRouen.getExtent());
};

(async () => {
  dieppeRouen = new KML('dieppeRouenVector', {
    billboard:
      { src: './plane.png', color: '#6689db' },
    color: '#6689db'
  });
  await dieppeRouen.addKmlFromUrl('./dieppe-rouen.kml');
  globus.planet.addLayer(dieppeRouen);
  globus.planet.flyExtent(dieppeRouen.getExtent());
})();
