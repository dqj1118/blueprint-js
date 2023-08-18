// @ts-nocheck
import { WebGLRenderer, PerspectiveCamera, AxesHelper, Scene, RGBFormat, LinearMipmapLinearFilter, sRGBEncoding } from 'three';
import { PCFSoftShadowMap, WebGLCubeRenderTarget, CubeCamera, MathUtils, NoToneMapping } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import {
    EVENT_ITEM_UPDATE, EVENT_ITEM_REMOVED, EVENT_CAMERA_ACTIVE_STATUS, EVENT_LOADED, EVENT_ITEM_SELECTED, EVENT_ITEM_MOVE, EVENT_ITEM_MOVE_FINISH, 
    EVENT_NO_ITEM_SELECTED, EVENT_WALL_CLICKED, EVENT_ROOM_CLICKED,
    EVENT_GLTF_READY, EVENT_NEW_ITEM, EVENT_NEW_ROOMS_ADDED, EVENT_MODE_RESET
} from '../core/events.js';
import { Skybox } from './skybox.js';
import { Edge3D } from './edge3d.js';
import { Floor3D } from './floor3d.js';
import { Physical3DItem } from './Physical3DItem.js';
import { DragRoomItemsControl3D } from './DragRoomItemsControl3D.js';
import { Configuration, viewBounds,shadowVisible } from '../core/configuration.js';
import {ConfigurationHelper} from '../helpers/ConfigurationHelper';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Vector3 } from 'three';

// mbn 
import * as THREE from 'three'; 
import {OBJLoader} from "../OBJLoader.js";
// mbn 


export const states = { UNSELECTED: 0, SELECTED: 1, DRAGGING: 2, ROTATING: 3, ROTATING_FREE: 4, PANNING: 5 };

export class Viewer3D extends Scene {
    constructor(model, element, opts) {
        super();
        let options = {
            occludedRoofs: false,
            occludedWalls: false,
            resize: true,
            pushHref: false,
            spin: true,
            spinSpeed: .00002,
            clickPan: true,
            canMoveFixedItems: false,
            gridVisibility: false,
            groundArrowhelper: false
        };
        for (let opt in options) {
            if (options.hasOwnProperty(opt) && opts.hasOwnProperty(opt)) {
                options[opt] = opts[opt];
            }
        }
        this.__physicalRoomItems = [];
        this.__enabled = false;
        this.model = model;
        this.floorplan = this.model.floorplan;
        this.__options = options;
        this.domElement = document.getElementById(element);
        this.perspectivecamera = null;
        this.camera = null;
        this.__environmentCamera = null;

        this.cameraNear = 10;
        this.cameraFar = 100000;
        this.controls = null;

        this.renderer = null;
        this.controller = null;

        this.needsUpdate = false;
        this.lastRender = Date.now();

        this.heightMargin = null;
        this.widthMargin = null;
        this.elementHeight = null;
        this.elementWidth = null;
        this.pauseRender = false;

        this.edges3d = [];
        this.floors3d = [];
        this.__currentItemSelected = null;
        this.__currentLightSelected = null;
        this.__rgbeLoader = null;

        this.needsUpdate = true;

        this.__newItemEvent = this.__addNewItem.bind(this);        
        this.__wallSelectedEvent = this.__wallSelected.bind(this);
        this.__roomSelectedEvent = this.__roomSelected.bind(this);
        this.__roomItemSelectedEvent = this.__roomItemSelected.bind(this);
        this.__roomItemUnselectedEvent = this.__roomItemUnselected.bind(this);
        this.__roomItemDraggedEvent = this.__roomItemDragged.bind(this);
        this.__roomItemDragFinishEvent = this.__roomItemDragFinish.bind(this);   
        
        this.__resetDesignEvent = this.__resetDesign.bind(this);

        this.init();        
    }


    init() {
        let scope = this;
        scope.scene = new Scene();
        this.name = 'Scene';
        scope.camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, scope.cameraNear, scope.cameraFar);

        let cubeRenderTarget = new WebGLCubeRenderTarget(16, { format: RGBFormat, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
        scope.__environmentCamera = new CubeCamera(1, 100000, cubeRenderTarget);
        scope.__environmentCamera.renderTarget.texture.encoding = sRGBEncoding;

        scope.renderer = scope.getARenderer();
        scope.domElement.appendChild(scope.renderer.domElement);

        scope.dragcontrols = new DragRoomItemsControl3D(this.floorplan.wallPlanesForIntersection, this.floorplan.floorPlanesForIntersection, this.physicalRoomItems, scope, scope.renderer.domElement);
        scope.controls = new OrbitControls(scope.camera, scope.domElement);

        // scope.controls.autoRotate = this.__options['spin'];
        scope.controls.enableDamping = false;
        scope.controls.dampingFactor = 0.1;
        scope.controls.maxPolarAngle = Math.PI * 1.0; //Math.PI * 0.35;//Math.PI * 1.0; //
        scope.controls.maxDistance = Configuration.getNumericValue(viewBounds);// 7500; //2500
        scope.controls.minDistance = 100; //1000; //1000
        scope.controls.screenSpacePanning = true;

        scope.skybox = new Skybox(this, scope.renderer);
        scope.camera.position.set(0, 600, 1500);
        scope.controls.update();

        scope.axes = new AxesHelper(500);        
        // handle window resizing
        scope.updateWindowSize();
        if (scope.__options.resize) {
            window.addEventListener('resize', () => { scope.updateWindowSize(); });
            window.addEventListener('orientationchange', () => { scope.updateWindowSize(); });
        }
        
        scope.model.addEventListener(EVENT_NEW_ITEM, scope.__newItemEvent);
        scope.model.addEventListener(EVENT_MODE_RESET, scope.__resetDesignEvent);
        scope.model.addEventListener(EVENT_LOADED, scope.addRoomItems.bind(scope));
        scope.floorplan.addEventListener(EVENT_NEW_ROOMS_ADDED, scope.addRoomsAndWalls.bind(scope));
        scope.controls.addEventListener('change', () => { scope.needsUpdate = true; });
        
        
        scope.dragcontrols.addEventListener(EVENT_ITEM_SELECTED, this.__roomItemSelectedEvent);
        scope.dragcontrols.addEventListener(EVENT_ITEM_MOVE, this.__roomItemDraggedEvent);
        scope.dragcontrols.addEventListener(EVENT_ITEM_MOVE_FINISH, this.__roomItemDragFinishEvent);
        scope.dragcontrols.addEventListener(EVENT_NO_ITEM_SELECTED, this.__roomItemUnselectedEvent);
        scope.dragcontrols.addEventListener(EVENT_WALL_CLICKED, this.__wallSelectedEvent);
        scope.dragcontrols.addEventListener(EVENT_ROOM_CLICKED, this.__roomSelectedEvent);
        

        // scope.controls.enabled = false;//To test the drag controls        
        //SEt the animation loop
        scope.renderer.setAnimationLoop(scope.render.bind(this));
        scope.render();
    }

    __focusOnWallOrRoom(normal, center, distance, y=0){
        let cameraPosition = center.clone().add(normal.clone().multiplyScalar(distance));        
        this.controls.target = center.clone();
        this.camera.position.copy(cameraPosition);
        this.controls.update();
        this.needsUpdate = true;
    }
    __wallSelected(evt) {
        let edge = evt.item;
        let y = Math.max(edge.wall.startElevation, edge.wall.endElevation) * 0.5;
        let center2d = edge.interiorCenter();
        let center = new Vector3(center2d.x, y, center2d.y);
        let distance = edge.interiorDistance() * 1.5;
        let normal = evt.normal;

        this.__focusOnWallOrRoom(normal, center, distance, y);
        this.dispatchEvent(evt);
    }

    __roomSelected(evt) {
        let room = evt.item;
        let y = room.corners[0].elevation;
        let normal = room.normal.clone();
        let center2d = room.areaCenter.clone();
        let center = new Vector3(center2d.x, 0, center2d.y);
        let distance = y * 3.0;
        this.__focusOnWallOrRoom(normal, center, distance, y);
        this.dispatchEvent(evt);
    }

    __roomItemSelected(evt) {
        if (this.__currentItemSelected) {
            this.__currentItemSelected.selected = false;
        }
        this.controls.enabled = false;
        this.__currentItemSelected = evt.item;
        this.__currentItemSelected.selected = true;
        this.needsUpdate = true;
        if (this.__currentItemSelected.itemModel != undefined) {
            evt.itemModel = this.__currentItemSelected.itemModel;
        }
        this.dispatchEvent(evt);
    }

    __roomItemDragged(evt) {        
        this.controls.enabled = false;
        this.needsUpdate = true;
    }

    __roomItemDragFinish(evt) {
        this.controls.enabled = true;
    }

    __roomItemUnselected(evt) {
        this.controls.enabled = true;
        if (this.__currentItemSelected) {
            this.dragcontrols.selected = null;
            this.__currentItemSelected.selected = false;
            this.__currentItemSelected = null;
            this.needsUpdate = true;
        }
        this.dispatchEvent(evt);
    }

    __addNewItem(evt) {
        if (!evt.item) {
            return;
        }
        
        let physicalRoomItem = new Physical3DItem(evt.item, this.dragcontrols, this.__options);
        this.add(physicalRoomItem);
        this.__physicalRoomItems.push(physicalRoomItem);
        this.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: physicalRoomItem });
        // this.dragcontrols.enabled = true;
        // this.dragcontrols.selected = physicalRoomItem;
        // this.needsUpdate = true;
    }

    __resetDesign(evt) {
        this.dragcontrols.selected = null;
        this.__physicalRoomItems.length = 0;
        this.edges3d.length = 0;
        this.floors3d.length = 0;
    }

    addRoomItems(evt) {
       
        let i = 0;
        let j = 0;
        for (; i < this.__physicalRoomItems.length; i++) {
            this.__physicalRoomItems[i].dispose();
            this.remove(this.__physicalRoomItems[i]);
        }
        this.__physicalRoomItems.length = 0; //A cool way to clear an array in javascript
        // mbn

        const viewDependenceNetworkShaderFunctions = `
            precision mediump float;

            layout(location = 0) out vec4 pc_FragColor;

            in vec2 vUv;

            uniform mediump sampler2D tDiffuse0x;
            uniform mediump sampler2D tDiffuse1x;
            uniform mediump sampler2D tDiffuse2x;

            uniform mediump sampler2D weightsZero;
            uniform mediump sampler2D weightsOne;
            uniform mediump sampler2D weightsTwo;

            mediump vec3 evaluateNetwork( mediump vec4 f0, mediump vec4 f1, mediump vec4 viewdir) {
                mediump float intermediate_one[NUM_CHANNELS_ONE] = float[](
                    BIAS_LIST_ZERO
                );
                for (int j = 0; j < NUM_CHANNELS_ZERO; ++j) {
                    mediump float input_value = 0.0;
                    if (j < 4) {
                    input_value =
                        (j == 0) ? f0.r : (
                        (j == 1) ? f0.g : (
                        (j == 2) ? f0.b : f0.a));
                    } else if (j < 8) {
                    input_value =
                        (j == 4) ? f1.r : (
                        (j == 5) ? f1.g : (
                        (j == 6) ? f1.b : f1.a));
                    } else {
                    input_value =
                        (j == 8) ? viewdir.r : (
                        (j == 9) ? -viewdir.b : viewdir.g); //switch y-z axes
                    }
                    for (int i = 0; i < NUM_CHANNELS_ONE; ++i) {
                    intermediate_one[i] += input_value *
                        texelFetch(weightsZero, ivec2(j, i), 0).x;
                    }
                }
                mediump float intermediate_two[NUM_CHANNELS_TWO] = float[](
                    BIAS_LIST_ONE
                );
                for (int j = 0; j < NUM_CHANNELS_ONE; ++j) {
                    if (intermediate_one[j] <= 0.0) {
                        continue;
                    }
                    for (int i = 0; i < NUM_CHANNELS_TWO; ++i) {
                        intermediate_two[i] += intermediate_one[j] *
                            texelFetch(weightsOne, ivec2(j, i), 0).x;
                    }
                }
                mediump float result[NUM_CHANNELS_THREE] = float[](
                    BIAS_LIST_TWO
                );
                for (int j = 0; j < NUM_CHANNELS_TWO; ++j) {
                    if (intermediate_two[j] <= 0.0) {
                        continue;
                    }
                    for (int i = 0; i < NUM_CHANNELS_THREE; ++i) {
                        result[i] += intermediate_two[j] *
                            texelFetch(weightsTwo, ivec2(j, i), 0).x;
                    }
                }
                for (int i = 0; i < NUM_CHANNELS_THREE; ++i) {
                    result[i] = 1.0 / (1.0 + exp(-result[i]));
                }
                return vec3(result[0]*viewdir.a+(1.0-viewdir.a),
                            result[1]*viewdir.a+(1.0-viewdir.a),
                            result[2]*viewdir.a+(1.0-viewdir.a));
                }


            void main() {

                vec4 diffuse0 = texture( tDiffuse0x, vUv );
                if (diffuse0.a < 0.6) discard;
                vec4 diffuse1 = texture( tDiffuse1x, vUv );
                vec4 diffuse2 = texture( tDiffuse2x, vUv );

                //deal with iphone
                diffuse0.a = diffuse0.a*2.0-1.0;
                diffuse1.a = diffuse1.a*2.0-1.0;
                diffuse2.a = diffuse2.a*2.0-1.0;

                //pc_FragColor.rgb  = diffuse1.rgb;
                pc_FragColor.rgb = evaluateNetwork(diffuse1,diffuse2,diffuse0);
                pc_FragColor.a = 1.0;
            }
        `;
        
        /**
                 * Creates a data texture containing MLP weights.
                 *
                 * @param {!Object} network_weights
                 * @return {!THREE.DataTexture}
                 */
        function createNetworkWeightTexture(network_weights) {
            let width = network_weights.length;
            let height = network_weights[0].length;

            let weightsData = new Float32Array(width * height);
            for (let co = 0; co < height; co++) {
                for (let ci = 0; ci < width; ci++) {
                    let index = co * width + ci;
                    let weight = network_weights[ci][co];
                    weightsData[index] = weight;
                }
            }
            let texture = new THREE.DataTexture(
            weightsData,
            width,
            height,
            THREE.RedFormat,
            THREE.FloatType
            );
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.needsUpdate = true;
            return texture;
        }

        /**
         * Creates shader code for the view-dependence MLP.
         *
         * This populates the shader code in viewDependenceNetworkShaderFunctions with
         * network weights and sizes as compile-time constants. The result is returned
         * as a string.
         *
         * @param {!Object} scene_params
         * @return {string}
         */
        function createViewDependenceFunctions(network_weights) {
            let width = network_weights["0_bias"].length;
            let biasListZero = "";
            for (let i = 0; i < width; i++) {
                let bias = network_weights["0_bias"][i];
                biasListZero += Number(bias).toFixed(7);
                if (i + 1 < width) {
                    biasListZero += ", ";
                }
            }

            width = network_weights["1_bias"].length;
            let biasListOne = "";
            for (let i = 0; i < width; i++) {
                let bias = network_weights["1_bias"][i];
                biasListOne += Number(bias).toFixed(7);
                if (i + 1 < width) {
                    biasListOne += ", ";
                }
            }

            width = network_weights["2_bias"].length;
            let biasListTwo = "";
            for (let i = 0; i < width; i++) {
                let bias = network_weights["2_bias"][i];
                biasListTwo += Number(bias).toFixed(7);
                if (i + 1 < width) {
                    biasListTwo += ", ";
                }
            }

            let channelsZero = network_weights["0_weights"].length;
            let channelsOne = network_weights["0_bias"].length;
            let channelsTwo = network_weights["1_bias"].length;
            let channelsThree = network_weights["2_bias"].length;

            let fragmentShaderSource = viewDependenceNetworkShaderFunctions.replace(
            new RegExp("NUM_CHANNELS_ZERO", "g"),
            channelsZero
            );
            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("NUM_CHANNELS_ONE", "g"),
            channelsOne
            );
            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("NUM_CHANNELS_TWO", "g"),
            channelsTwo
            );
            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("NUM_CHANNELS_THREE", "g"),
            channelsThree
            );

            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("BIAS_LIST_ZERO", "g"),
            biasListZero
            );
            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("BIAS_LIST_ONE", "g"),
            biasListOne
            );
            fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp("BIAS_LIST_TWO", "g"),
            biasListTwo
            );

            return fragmentShaderSource;
        }

        // container = document.getElementById("container");
        const preset_size_w = 800;
        const preset_size_h = 800;
        // container.appendChild(renderer.domElement);

        // Problem 
        // Create a multi render target with Float buffers
        // renderTarget = new THREE.WebGLMultipleRenderTargets(
        //     preset_size_w * 2,
        //     preset_size_h * 2,
        //     3
        // );

        this.renderTarget = new THREE.WebGLMultipleRenderTargets(
            preset_size_w * 2,
            preset_size_h * 2,
            3
        );

        for (let i = 0, il = this.renderTarget.texture.length; i < il; i++) {
            // const paragraph = document.createElement('p');
            // paragraph.innerHTML = `<strong>${i}:</strong>}`;
            // outputElement.appendChild(paragraph);
            this.renderTarget.texture[i].minFilter = THREE.LinearFilter;
            this.renderTarget.texture[i].magFilter = THREE.LinearFilter;
            this.renderTarget.texture[i].type = THREE.FloatType;
        }

        // load a resource

        fetch("chair_phone/mlp.json")
            .then((response) => {
            return response.json();
            })
            .then((json) => {
                for (let i = 0, il = json["obj_num"]; i < il; i++) {
                  let tex0 = new THREE.TextureLoader().load(
                    "chair_phone/shape" + i.toFixed(0) + ".png" + "feat0.png",
                    // function () {
                    //   render();
                    // }
                  );
                  tex0.magFilter = THREE.NearestFilter;
                  tex0.minFilter = THREE.NearestFilter;
                  let tex1 = new THREE.TextureLoader().load(
                      "chair_phone/shape" + i.toFixed(0) + ".png" + "feat1.png",
                    //   function () {
                    //       render();
                    //   }
                  );
                  tex1.magFilter = THREE.NearestFilter;
                  tex1.minFilter = THREE.NearestFilter;
                  let newmat = new THREE.RawShaderMaterial({
                    side: THREE.DoubleSide,
                    vertexShader: document
                      .querySelector("#gbuffer-vert")
                      .textContent.trim(),
                    fragmentShader: document
                      .querySelector("#gbuffer-frag")
                      .textContent.trim(),
                    uniforms: {
                      tDiffuse0: { value: tex0 },
                      tDiffuse1: { value: tex1 },
                    },
                    glslVersion: THREE.GLSL3,
                });
                
                new OBJLoader().load(
                    "chair_phone/shape" + i.toFixed(0) + ".obj",
                    object => {
                        // Problem 
                        object.traverse(function (child) {
                            if (child.type == "Mesh") {
                            child.material = newmat;
                            }
                        });
                        object.scale.set(50, 50, 50); 
                        object.position.x = 100;
                        object.position.y = 50;
                        object.position.z = 150;
                        // let mbnRoomItem = new Physical3DItem(object, this.dragcontrols, this.__options);
                        this.add(object);
                    });
                }
            });
            
        // mbn 
        
        let roomItems = this.model.roomItems;
        for (i = 0; i < roomItems.length; i++) {
            let physicalRoomItem = new Physical3DItem(roomItems[i], this.dragcontrols, this.__options);
            this.add(physicalRoomItem);
            this.__physicalRoomItems.push(physicalRoomItem);
        }
    }

    addRoomsAndWalls() {
        let scope = this;
        let i = 0;
        let floorplanDimensions;
        let floorplanCenter;
        let multiplier;
        let ymultiplier;
        let wallEdges;
        let rooms;
        let threeFloor;
        let edge3d;
        scope.floors3d.forEach((floor) => {
            floor.destroy();
            floor = null;
        });
        scope.edges3d.forEach((edge3d) => {
            edge3d.remove();
            edge3d = null;
        });
        scope.edges3d = [];
        scope.floors3d = [];
        wallEdges = scope.floorplan.wallEdges();
        rooms = scope.floorplan.getRooms();
        // draw floors
        for (i = 0; i < rooms.length; i++) {
            threeFloor = new Floor3D(scope, rooms[i], scope.controls, this.__options);
            scope.floors3d.push(threeFloor);
        }
        for (i = 0; i < wallEdges.length; i++) {
            edge3d = new Edge3D(scope, wallEdges[i], scope.controls, this.__options);
            scope.edges3d.push(edge3d);
        }
        floorplanDimensions = scope.floorplan.getDimensions();
        floorplanCenter = scope.floorplan.getDimensions(true);
        multiplier = 1.5;
        ymultiplier = 0.5;
        
        if(scope.floorplan.corners.length){
            scope.controls.target = floorplanCenter.clone();
            scope.camera.position.set(floorplanDimensions.x*multiplier, floorplanDimensions.length()*ymultiplier, floorplanDimensions.z*multiplier);
            scope.controls.update();
            scope.shouldRender = true;
        }        
    }

    getARenderer() {
        let renderer = new WebGLRenderer({ antialias: true, alpha: true });
        renderer.autoClear = true; //true
        renderer.shadowMap.enabled = true;
        // renderer.shadowMapAutoUpdate = true;
        renderer.physicallyCorrectLights = true;
        renderer.shadowMap.type = PCFSoftShadowMap;
        // renderer.setClearColor(0xFFFFFF, 1);
        renderer.setClearColor(0x000000, 0.0);
        renderer.outputEncoding = sRGBEncoding;
        renderer.toneMapping = NoToneMapping;
        // renderer.toneMappingExposure = 0.5;
        // renderer.toneMappingExposure = Math.pow(0.7, 5.0);
        renderer.setPixelRatio(window.devicePixelRatio);
        return renderer;
    }

    updateWindowSize() {
        let heightMargin = this.domElement.offsetTop;
        let widthMargin = this.domElement.offsetLeft;
        let elementWidth = (this.__options.resize) ? window.innerWidth - widthMargin : this.domElement.clientWidth;
        let elementHeight = (this.__options.resize) ? window.innerHeight - heightMargin : this.domElement.clientHeight;

        this.camera.aspect = elementWidth / elementHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(elementWidth, elementHeight);
        this.needsUpdate = true;
    }

    render() {
        if (!this.enabled) {
            return;
        }
        let scope = this;
        // scope.controls.update();
        if (!scope.needsUpdate) {
            return;
        }
        scope.renderer.render(scope, scope.camera);
        scope.lastRender = Date.now();
        this.needsUpdate = false      
    }

    pauseTheRendering(flag) {
        this.needsUpdate = flag;
    }

    exportSceneAsGTLF() {
        let scope = this;
        let exporter = new GLTFExporter();
        exporter.parse(this, function(gltf) {
            scope.dispatchEvent({ type: EVENT_GLTF_READY, gltf: JSON.stringify(gltf) });
        });
    }

    forceRender() {
        let scope = this;
        scope.renderer.render(scope, scope.camera);
        scope.lastRender = Date.now();
    }

    addRoomplanListener(type, listener) {
        this.addEventListener(type, listener);
    }

    removeRoomplanListener(type, listener) {
        this.removeEventListener(type, listener);
    }

    get environmentCamera() {
        return this.__environmentCamera;
    }

    get physicalRoomItems() {
        return this.__physicalRoomItems;
    }

    get enabled() {
        return this.__enabled;
    }

    set enabled(flag) {
        this.dragcontrols.deactivate();
        this.__enabled = flag;
        this.controls.enabled = flag;
        if (flag) {
            this.dragcontrols.activate();
        }
    }

}