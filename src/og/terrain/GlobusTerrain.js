/**
 * @module og/terrainProvider/GlobusTerrain
 */

'use strict';

import * as mercator from '../mercator.js';
import { cartesianToBarycentricLonLat } from '../utils/shared.js';
import { EmptyTerrain } from './EmptyTerrain.js';
import { EPSG3857 } from '../proj/EPSG3857.js';
import { Events } from '../Events.js';
import { Loader } from '../utils/Loader.js';
import { NOTRENDERING } from '../quadTree/quadTree.js';
import { QueueArray } from '../QueueArray.js';
import { stringTemplate } from '../utils/shared.js';
import { Geoid } from './Geoid.js';
import { Layer } from '../layer/Layer.js';
import { Vec2 } from '../math/Vec2.js';
import { Vec3 } from '../math/Vec3.js';
import { Extent } from '../Extent.js';
import { LonLat } from '../LonLat.js';

const ELL = 0;
const MSL = 1;
const GND = 2;

export const heightMode = {
    "ell": ELL,
    "msl": MSL,
    "gnd": GND
};


const EVENT_NAMES = [
    /**
    * Triggered when current elevation tile has loaded but before rendereing.
    * @event og.terrain.GlobusTerrain#load
    */
    "load",

    /**
    * Triggered when all elevation tiles have loaded or loading has stopped.
    * @event og.terrain.GlobusTerrain#loadend
    */
    "loadend"
];

/**
 * Class that loads segment elevation data, converts it to the array and passes it to the planet segment.
 * @class
 * @extends {og.terrain.EmptyTerrain}
 * @param {string} [name=""] - Terrain provider name.
 * @param {Object} [options] - Provider options:
 * @param {number} [options.minZoom=3] - Minimal visible zoom index when terrain handler works.
 * @param {number} [options.minZoom=14] - Maximal visible zoom index when terrain handler works.
 * @param {string} [options.url="//openglobus.org/heights/srtm3/{z}/{y}/{x}.ddm"] - Terrain source path url template. Default is openglobus ddm elevation file.
 * @param {Array.<number>} [options.gridSizeByZoom] - Array of segment triangulation grid sizes where array index agreed to the segment zoom index.
 * @param {number} [options.fileGridSize=32] - Elevation tile grid size. Default is 32x32.
 * @param {string} [options.responseType="arraybuffer"] - Ajax responce type.
 * @param {number} [options.MAX_LOADING_TILES] - Maximum at one time loading tiles.
 * @fires og.terrain.GlobusTerrain#load
 * @fires og.terrain.GlobusTerrain#loadend
 */
class GlobusTerrain extends EmptyTerrain {
    constructor(name, options) {

        super();

        options = options || {};

        this.blur = true;

        this.equalizeNormals = true;

        /**
         * Provider name.
         * @public
         * @type {string}
         */
        this.name = name || "";

        /**
         * Minimal visible zoom index when terrain handler works.
         * @public
         * @type {number}
         */
        this.minZoom = options.minZoom || 3;

        /**
         * Maximal visible zoom index when terrain handler works.
         * @public
         * @type {number}
         */
        this.maxZoom = options.maxZoom || 14;

        this._geoid = new Geoid({
            'src': "//openglobus.org/geoid/egm96-15.pgm"
        });

        /**
         * Terrain source path url template. 
         * @public
         * @type {string}
         */
        this.url = options.url || "//openglobus.org/heights/srtm3/{z}/{y}/{x}.ddm";

        this._dataType = "arrayBuffer";

        /**
         * Array of segment triangulation grid sizes where array index agreed to the segment zoom index.
         * @public
         * @type {Array.<number>}
         */
        this.gridSizeByZoom = options.gridSizeByZoom || [64, 32, 32, 16, 16, 8, 8, 8, 8, 16, 16, 16, 16, 32, 32, 16, 8, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2];

        this._maxNodeZoom = this.gridSizeByZoom.length - 1;

        /**
         * Elevation tile grid size.
         * @public
         * @type {number}
         */
        this.fileGridSize = options.fileGridSize || 32;

        /**
         * Events handler.
         * @public
         * @type {og.Events}
         */
        this.events = new Events(EVENT_NAMES, this);

        this._elevationCache = {};

        this._fetchCache = {};

        this._loader = new Loader();

        /**
         * Rewrites elevation storage url query.
         * @private
         * @callback og.terrain.GlobusTerrain~_urlRewriteCallback
         * @param {og.planetSegment.Segment} segment - Segment to load.
         * @param {string} url - Created url.
         * @returns {string} - Url query string.
         */
        this._urlRewriteCallback = null;

        this._ellToAltFn = [
            (lonLat, altEll, callback) => callback(altEll),
            (lonLat, altEll, callback) => callback(altEll - this._geoid.getHeightLonLat(lonLat)),
            (lonLat, altEll, callback) => {

                //TODO: if heights above ellipsoid wgs84 do
                let altMsl = this._geoid.getHeightLonLat(lonLat);

                let z = this.maxZoom,
                    x = mercator.getTileX(lonLat.lon, z),
                    y = mercator.getTileY(lonLat.lat, z);

                // OPTIMIZATION
                // let z2 = Math.pow(2, z);
                // let size = mercator.POLE * 2 / z2;
                // let merc = mercator.forward(lonLat);
                // x = Math.floor((mercator.POLE + merc.lon) / size);
                // y = z2 - Math.floor((mercator.POLE??? + merc.lat) / size) - 1;

                let tileIndex = Layer.getTileIndex(x, y, z);

                let cache = this._elevationCache[tileIndex];

                if (cache) {
                    return callback(altEll - (this._getGroundHeight(lonLat, cache) + altMsl));
                } else {

                    if (!this._fetchCache[tileIndex]) {
                        let url = stringTemplate(this.url, {
                            "x": x,
                            "y": y,
                            "z": z
                        });
                        this._fetchCache[tileIndex] = this._loader.fetch({
                            'src': url,
                            'type': this._dataType
                        });
                    }

                    this._fetchCache[tileIndex].then((response) => {
                        if (response.status === "ready") {
                            let cache = {
                                heights: this._createHeights(response.data),
                                extent: mercator.getTileExtent(x, y, z)
                            };
                            this._elevationCache[tileIndex] = cache;
                            callback(altEll - (this._getGroundHeight(lonLat, cache) + altMsl));
                        } else if (response.status === "abort") {
                            this._fetchCache[tileIndex] = null;
                            delete this._fetchCache[tileIndex];
                        } else if (response.status === "error") {
                            let cache = {
                                heights: [],
                                extent: mercator.getTileExtent(x, y, z)
                            };
                            this._elevationCache[tileIndex] = cache;
                            callback(altEll - altMsl);
                        } else {
                            this._fetchCache[tileIndex] = null;
                            delete this._fetchCache[tileIndex];
                        }
                    });
                }
            },
        ];
    }

    _getGroundHeight(lonLat, tileData) {
        let merc = mercator.forward(lonLat);

        let w = tileData.extent.getWidth(),
            gs = Math.sqrt(tileData.heights.length);

        if (!tileData.extent.isInside(merc)) {
            console.log("GlobusTerrain.js 221 - error!");
            debugger;
        }

        let size = w / (gs - 1);

        /*
        v2-----------v3
        |            |
        |            |
        |            |
        v0-----------v1
        */

        let i = gs - Math.ceil((merc.lat - tileData.extent.southWest.lat) / size) - 1,
            j = Math.floor((merc.lon - tileData.extent.southWest.lon) / size);

        let v0Ind = (i + 1) * gs + j,
            v1Ind = v0Ind + 1,
            v2Ind = i * gs + j,
            v3Ind = v2Ind + 1;

        let h0 = tileData.heights[v0Ind],
            h1 = tileData.heights[v1Ind],
            h2 = tileData.heights[v2Ind],
            h3 = tileData.heights[v3Ind];

        let v0 = new LonLat(tileData.extent.southWest.lon + size * j, tileData.extent.northEast.lat - size * i - size),
            v1 = new LonLat(v0.lon + size, v0.lat),
            v2 = new LonLat(v0.lon, v0.lat + size),
            v3 = new LonLat(v0.lon + size, v0.lat + size);

        let TEST = new Extent(v0, v3);
        if (!TEST.isInside(merc)) {
            console.log("GlobusTerrain.js 251 - error!");
            debugger;
        }

        let c = new Array(3);

        if (cartesianToBarycentricLonLat(merc, v0, v1, v2, c)) {
            return h0 * c[0] + h1 * c[1] + h2 * c[2];
        } else if (cartesianToBarycentricLonLat(merc, v1, v2, v3, c)) {
            return h1 * c[0] + h2 * c[1] + h3 * c[2];
        } else {
            console.log("GlobusTerrain.js 266 - error!");
            debugger;
        }
    }

    getHeightAsync(heightMode = ELL, lonLat, callback, altEll = 0.0) {
        this._ellToAltFn[heightMode](lonLat, altEll, callback);
    }

    /**
     * Stop loading.
     * @public
     */
    abortLoading() {
        this._loader.abort();
    }

    /**
     * Sets terrain data url template.
     * @public
     * @param {string} url - Url template.
     * @example <caption>Default openglobus url template:</caption>:
     * "http://earth3.openglobus.org/{z}/{y}/{x}.ddm"
     */
    setUrl(url) {
        this.url = url;
    }

    /**
     * Sets provider name.
     * @public
     * @param {string} name - Name.
     */
    setName(name) {
        this.name = name;
    }

    /**
     * Starts to load segment data.
     * @public
     * @virtual
     * @param {og.planetSegment.Segment} segment - Segment that wants a terrain data.
     */
    loadTerrain(segment, forceLoading) {
        if (this._planet.terrainLock.isFree()) {
            segment.terrainReady = false;
            segment.terrainIsLoading = true;
            if (segment._projection.id === EPSG3857.id) {
                let cache = this._elevationCache[segment.tileIndex];
                if (cache) {
                    this._applyElevationsData(segment, cache.heights);
                } else {

                    this._loader.load({
                        'src': this._getHTTPRequestString(segment),
                        'segment': segment,
                        'type': this._dataType,
                        'filter': () => segment.plainReady && segment.node.getState() !== NOTRENDERING || forceLoading
                    }, response => {
                        if (response.status === "ready") {
                            let heights = this._createHeights(response.data);
                            this._elevationCache[segment.tileIndex] = {
                                heights: heights,
                                extent: segment.getExtent()
                            };
                            this._applyElevationsData(segment, heights);
                        } else if (response.status === "abort") {
                            segment.terrainIsLoading = false;
                        } else if (response.status === "error") {
                            this._applyElevationsData(segment, null);
                        } else {
                            segment.terrainIsLoading = false;
                        }
                    });
                }
            } else {
                //TODO: poles elevation
            }
        } else {
            segment.terrainIsLoading = false;
        }
    }

    /**
     * Creates query url.
     * @protected
     * @virtual
     * @param {og.planetSegment.Segment} segment -
     * @returns {string} -
     */
    _createUrl(segment) {
        return stringTemplate(this.url, {
            "x": segment.tileX.toString(),
            "y": segment.tileY.toString(),
            "z": segment.tileZoom.toString()
        });
    }

    /**
     * Returns actual url query string.
     * @protected
     * @param {og.planetSegment.Segment} segment - Segment that loads elevation data.
     * @returns {string} -
     */
    _getHTTPRequestString(segment) {
        var url = this._createUrl(segment);
        return this._urlRewriteCallback ? this._urlRewriteCallback(segment, url) : url;
    }

    /**
     * Sets url rewrite callback, used for custom url rewriting for every tile laoding.
     * @public
     * @param {og.terrain.GlobusTerrain~_urlRewriteCallback} ur - The callback that returns tile custom created url.
     */
    setUrlRewriteCallback(ur) {
        this._urlRewriteCallback = ur;
    }

    /**
     * Converts loaded data to segment elevation data type(columr major elevation data array in meters)
     * @public
     * @virtual
     * @param {*} data - Loaded elevation data.
     * @returns {Array.<number>} -
     */
    _createHeights(data) {
        return new Float32Array(data);
    }

    /**
     * @protected
     * @param {og.planetSegment.Segment} segment -
     * @param {*} data -
     */
    _applyElevationsData(segment, elevations) {
        if (segment) {
            var e = this.events.load;
            if (e.handlers.length) {
                this.events.dispatch(e, {
                    "elevations": elevations,
                    "segment": segment
                });
            }
            segment.applyTerrain(elevations);
        }
    }
}

export { GlobusTerrain };
