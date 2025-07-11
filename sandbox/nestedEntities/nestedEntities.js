/* eslint-disable no-undef */
import {
    control,
    Entity,
    Object3d,
    Renderer,
    Vec3,
    Mat4,
    RenderNode,
    EntityCollection,
    scene,
} from "../../lib/og.es.js";

let renderer = new Renderer("frame", {
    msaa: 8,
    controls: [new control.SimpleNavigation({ speed: 0.01 }), new control.GeoObjectEditor()],
    autoActivate: true
});

class MyScene extends RenderNode {
    constructor() {
        super("MyScene");
    }

    init() {
        const baseObj = Object3d.createCube(0.4, 2, 0.4).translate(new Vec3(0, 1, 0)).setMaterial({
            ambient: "#882a2a",
            diffuse: "#fb3434",
            shininess: 1
        });

        const frustumObj = Object3d.createFrustum(3, 2, 1).setMaterial({
            ambient: "#236028",
            diffuse: "#1cdd23",
            shininess: 1
        });

        const cylinderObj = Object3d.createCylinder(1, 0, 1)
            .applyMat4(new Mat4().setRotation(new Vec3(1, 0, 0), (90 * Math.PI) / 180))
            .setMaterial({
                ambient: "#773381",
                diffuse: "#ef00ff",
                shininess: 1
            });

        let parentEntity = new Entity({
            cartesian: new Vec3(0, 0, 0),
            independentPicking: true,
            geoObject: {
                color: "rgb(90,90,90)",
                scale: 1,
                instanced: true,
                tag: `baseObj`,
                object3d: baseObj
            }
        });

        let childEntity = new Entity({
            cartesian: new Vec3(0, 1, 0),
            independentPicking: true,
            relativePosition: true,
            geoObject: {
                color: "rgb(90,90,90)",
                instanced: true,
                tag: `frustumObj`,
                object3d: frustumObj
            }
        });

        let childChildEntity = new Entity({
            cartesian: new Vec3(0, 3, -1),
            independentPicking: true,
            relativePosition: true,
            geoObject: {
                color: "rgb(90,90,90)",
                instanced: true,
                tag: `cylinderObj`,
                object3d: cylinderObj
            }
        });

        childEntity.appendChild(childChildEntity);
        parentEntity.appendChild(childEntity);

        let collection = new EntityCollection({
            entities: [parentEntity]
        });

        collection.addTo(this);

        this.renderer.activeCamera.set(new Vec3(-4, 11, 13), new Vec3(1, 0, 0));

        this.renderer.activeCamera.update();
    }
}

renderer.addNodes([new scene.Axes(), new MyScene()]);

