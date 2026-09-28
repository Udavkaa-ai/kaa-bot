#!/usr/bin/env python3
"""GeoPackage (полигоны, WGS 84) → GeoJSON без внешних библиотек.
Для исторических границ RISTAT (1897): python3 gpkg-to-geojson.py <файл.gpkg> <таблица> <выход.geojson>"""
import sqlite3, struct, json, sys

def wkb(b, o=0):
    e = '<' if b[o] == 1 else '>'
    t = struct.unpack_from(e + 'I', b, o + 1)[0]
    o += 5
    base, dims = t % 1000, {0: 2, 1: 3, 2: 3, 3: 4}[t // 1000]
    def ring(o):
        n = struct.unpack_from(e + 'I', b, o)[0]; o += 4; pts = []
        for _ in range(n):
            xy = struct.unpack_from(e + 'd' * dims, b, o); o += 8 * dims
            pts.append([round(xy[0], 5), round(xy[1], 5)])
        return pts, o
    if base == 3:
        n = struct.unpack_from(e + 'I', b, o)[0]; o += 4; rings = []
        for _ in range(n): r, o = ring(o); rings.append(r)
        return {'type': 'Polygon', 'coordinates': rings}, o
    if base == 6:
        n = struct.unpack_from(e + 'I', b, o)[0]; o += 4; polys = []
        for _ in range(n): g, o = wkb(b, o); polys.append(g['coordinates'])
        return {'type': 'MultiPolygon', 'coordinates': polys}, o
    raise ValueError('геометрия %d не поддерживается' % t)

def gpkg_geom(blob):
    env = (blob[3] >> 1) & 7
    return wkb(blob, 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env])[0]

src, table, out = sys.argv[1:4]
cur = sqlite3.connect(src).cursor()
cols = [c[1] for c in cur.execute(f"pragma table_info('{table}')")]
feats = []
for row in cur.execute(f"select * from '{table}'"):
    d = dict(zip(cols, row))
    feats.append({'type': 'Feature', 'geometry': gpkg_geom(d.pop('geom')), 'properties': d})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w'), ensure_ascii=False)
print(out, len(feats))
