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
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass';

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
        // scope.scene = new Scene();
        this.name = 'Scene';
        scope.camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, scope.cameraNear, scope.cameraFar);

        let cubeRenderTarget = new WebGLCubeRenderTarget(16, { format: RGBFormat, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });

        // mbn 
        // scope.renderTargt = cubeRenderTarget
        // mbn 
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
        
        // mbn 
        const viewDependenceNetworkShaderFunctions = `
            precision mediump float;

            in vec2 vUv;
            in vec3 vPosition;
            in vec3 rayDirection;

            out vec4 fragColor;

            uniform mediump sampler2D tDiffuse0;
            uniform mediump sampler2D tDiffuse1;

            mediump vec3 evaluateNetwork( mediump vec4 f0, mediump vec4 f1, mediump vec4 viewdir) {
                mediump mat4 intermediate_one = mat4(
                    BIAS_LIST_ZERO
                );
                intermediate_one += f0.r * mat4(__W0_0__)
                    + f0.g * mat4(__W0_1__)
                    + f0.b * mat4(__W0_2__)
                    + f0.a * mat4(__W0_3__)
                    + f1.r * mat4(__W0_4__)
                    + f1.g * mat4(__W0_5__)
                    + f1.b * mat4(__W0_6__)
                    + f1.a * mat4(__W0_7__)
                    + viewdir.r * mat4(__W0_8__)
                    - viewdir.b * mat4(__W0_9__)
                    + viewdir.g * mat4(__W0_10__); //switch y-z axes
                intermediate_one[0] = max(intermediate_one[0], 0.0);
                intermediate_one[1] = max(intermediate_one[1], 0.0);
                intermediate_one[2] = max(intermediate_one[2], 0.0);
                intermediate_one[3] = max(intermediate_one[3], 0.0);
                mediump mat4 intermediate_two = mat4(
                    BIAS_LIST_ONE
                );
                intermediate_two += intermediate_one[0][0] * mat4(__W1_0__)
                    + intermediate_one[0][1] * mat4(__W1_1__)
                    + intermediate_one[0][2] * mat4(__W1_2__)
                    + intermediate_one[0][3] * mat4(__W1_3__)
                    + intermediate_one[1][0] * mat4(__W1_4__)
                    + intermediate_one[1][1] * mat4(__W1_5__)
                    + intermediate_one[1][2] * mat4(__W1_6__)
                    + intermediate_one[1][3] * mat4(__W1_7__)
                    + intermediate_one[2][0] * mat4(__W1_8__)
                    + intermediate_one[2][1] * mat4(__W1_9__)
                    + intermediate_one[2][2] * mat4(__W1_10__)
                    + intermediate_one[2][3] * mat4(__W1_11__)
                    + intermediate_one[3][0] * mat4(__W1_12__)
                    + intermediate_one[3][1] * mat4(__W1_13__)
                    + intermediate_one[3][2] * mat4(__W1_14__)
                    + intermediate_one[3][3] * mat4(__W1_15__);
                intermediate_two[0] = max(intermediate_two[0], 0.0);
                intermediate_two[1] = max(intermediate_two[1], 0.0);
                intermediate_two[2] = max(intermediate_two[2], 0.0);
                intermediate_two[3] = max(intermediate_two[3], 0.0);
                mediump vec3 result = vec3(
                    BIAS_LIST_TWO
                );
                result += intermediate_two[0][0] * vec3(__W2_0__)
                        + intermediate_two[0][1] * vec3(__W2_1__)
                        + intermediate_two[0][2] * vec3(__W2_2__)
                        + intermediate_two[0][3] * vec3(__W2_3__)
                        + intermediate_two[1][0] * vec3(__W2_4__)
                        + intermediate_two[1][1] * vec3(__W2_5__)
                        + intermediate_two[1][2] * vec3(__W2_6__)
                        + intermediate_two[1][3] * vec3(__W2_7__)
                        + intermediate_two[2][0] * vec3(__W2_8__)
                        + intermediate_two[2][1] * vec3(__W2_9__)
                        + intermediate_two[2][2] * vec3(__W2_10__)
                        + intermediate_two[2][3] * vec3(__W2_11__)
                        + intermediate_two[3][0] * vec3(__W2_12__)
                        + intermediate_two[3][1] * vec3(__W2_13__)
                        + intermediate_two[3][2] * vec3(__W2_14__)
                        + intermediate_two[3][3] * vec3(__W2_15__);
                result = 1.0 / (1.0 + exp(-result));
                return result*viewdir.a+(1.0-viewdir.a);
            }


            void main() {

                vec4 diffuse1 = texture( tDiffuse0, vUv );
                if (diffuse1.r == 0.0) discard;
                vec4 diffuse0 = vec4( normalize(rayDirection), 1.0 );
                vec4 diffuse2 = texture( tDiffuse1, vUv );

                //deal with iphone
                diffuse1.a = diffuse1.a*2.0-1.0;
                diffuse2.a = diffuse2.a*2.0-1.0;

                //fragColor.rgb  = diffuse1.rgb;
                fragColor.rgb = evaluateNetwork(diffuse1,diffuse2,diffuse0);
                fragColor.a = 1.0;
            }
        `;

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

        let fragmentShaderSource = viewDependenceNetworkShaderFunctions;

        fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp('BIAS_LIST_ZERO', 'g'), network_weights['0_bias'].join(', '));
        fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp('BIAS_LIST_ONE', 'g'), network_weights['1_bias'].join(', '));
        fragmentShaderSource = fragmentShaderSource.replace(
            new RegExp('BIAS_LIST_TWO', 'g'), network_weights['2_bias'].join(', '));

        for(let i = 0; i < network_weights['0_weights'].length; i++) {
            fragmentShaderSource = fragmentShaderSource.replace(
                new RegExp(`__W0_${i}__`, 'g'), network_weights['0_weights'][i].join(', '));
        }
        for(let i = 0; i < network_weights['1_weights'].length; i++) {
            fragmentShaderSource = fragmentShaderSource.replace(
                new RegExp(`__W1_${i}__`, 'g'), network_weights['1_weights'][i].join(', '));
        }
        for(let i = 0; i < network_weights['2_weights'].length; i++) {
            fragmentShaderSource = fragmentShaderSource.replace(
                new RegExp(`__W2_${i}__`, 'g'), network_weights['2_weights'][i].join(', '));
        }

        return fragmentShaderSource;
        }

        // container = document.getElementById("container");
        'Number of pixels, to make the chair more detailed.'
        const preset_size_w = 2000;
        const preset_size_h = 2000;
        // container.appendChild(renderer.domElement);

        scope.renderTarget = new THREE.WebGLMultipleRenderTargets(
            preset_size_w * 2,
            preset_size_h * 2,
            3
        );

        for (let i = 0, il = scope.renderTarget.texture.length; i < il; i++) {
            // const paragraph = document.createElement('p');
            // paragraph.innerHTML = `<strong>${i}:</strong>}`;
            // outputElement.appendChild(paragraph);
            scope.renderTarget.texture[i].minFilter = THREE.LinearFilter;
            scope.renderTarget.texture[i].magFilter = THREE.LinearFilter;
            scope.renderTarget.texture[i].type = THREE.FloatType;
        }

        // load a resource
 

        fetch("chair_phone/mlp.json")
            .then((response) => {
            return response.json();
            })
            .then((json) => {

                let network_weights = json;
                let fragmentShaderSource = createViewDependenceFunctions(network_weights);
                scope.objects = [];

                // For Mobile Nerf input object 
                scope.isMBNobject = true; 
                for (let i = 0, il = json["obj_num"]; i < il; i++) {
                    let tex0 = new THREE.TextureLoader().load(
                        "chair_phone/shape" + i.toFixed(0) + ".png" + "feat0.png",
                        // () => {
                        //     scope.render();
                        // }
                    );
                    tex0.magFilter = THREE.NearestFilter;
                    tex0.minFilter = THREE.NearestFilter;
                    let tex1 = new THREE.TextureLoader().load(
                        "chair_phone/shape" + i.toFixed(0) + ".png" + "feat1.png",
                        // () => {
                        //     scope.render();
                        // }
                    );
                    tex1.magFilter = THREE.NearestFilter;
                    tex1.minFilter = THREE.NearestFilter;
                    let newmat = new THREE.RawShaderMaterial({
                        side: THREE.DoubleSide,
                        vertexShader: document.querySelector( '#gbuffer-vert' ).textContent.trim(),
                        fragmentShader: fragmentShaderSource,
                        uniforms: {
                            tDiffuse0: { value: tex0 },
                            tDiffuse1: { value: tex1 },
                        },
                        glslVersion: THREE.GLSL3
                    });
                    // newmat.depthTest = true;
                    // newmat.colorWrite = false; 
                    new OBJLoader().load(
                        "chair_phone/shape" + i.toFixed(0) + ".obj",
                        object => {
                            // Problem 
                            object.traverse(function (child) {
                                if (child.type == "Mesh") {
                                    child.material = newmat;
                                    // child.visible = true; 
                                }
                            });

                            // mannually set mbn object position 
                            object.scale.set(50, 50, 50); 
                            object.position.x = 1000;
                            object.position.y = 50;
                            object.position.z = 150;

                            document.addEventListener('keydown', function(event) {
                                switch(event.keyCode) {
                                    case 37: // Left arrow
                                        object.position.x -= 10;
                                        break;
                                    case 39: // Right arrow
                                        object.position.x += 10;
                                        break;
                                    case 38: // Up arrow
                                        object.position.z -= 10;
                                        break;
                                    case 40: // Down arrow
                                        object.position.z += 10;
                                        break;
                                }
                            });
                            scope.add(object);

                        }
                    );

                }

                // PostProcessing setup


            });
            
        // mbn

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

        // mbn
        var animate = function () {
            requestAnimationFrame(animate);
            scope.render(); 
        };
        animate();   
        // mbn
        // scope.renderer.setAnimationLoop(scope.render.bind(this)); 
        // scope.render();
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
        // mbn 
        let renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance",
        precision: "highp" });
        // mbn 
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
        scope.lastRender = Date.now();
        this.needsUpdate = false;    
        
        scope.renderer.render(scope, scope.camera);

        // mbn

        // scope.quad.lookAt(scope.camera.position); 
        
        'quad is rendered here using renderTarget'
        // scope.camera.lookAt(scope.quad.position);

        // scope.quad.visible = false; 
        // scope.renderer.setRenderTarget(scope.renderTarget);
        // scope.renderer.clear(); 
        // scope.renderer.render(scope, scope.camera);
        // scope.renderer.autoClear = false;

        // scope.quad.visible = true;
        // 'quad appears here'
        // scope.renderer.setRenderTarget(null);
        // scope.renderer.render(scope.postScene, scope.postCamera);
        // scope.renderer.render(scope, scope.camera);


        // scope.renderer.setRenderTarget(scope.renderTarget);
        // scope.renderer.clear(); 
        // scope.renderer.render(scope, scope.camera);
        // scope.renderer.autoClear = false;
        // scope.renderer.render(scope.postScene, scope.postCamera);  
        // mbn 

        
         
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