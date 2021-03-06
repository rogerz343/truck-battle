/**
 * Client-side driving code for MultiTruck.
 * Credits: physics/driving mechanics adapted from AGI's "Monster Milktruck" demo
 */

/**
 * great lesson: you need to normalize orthonormal vectors at every tick; otherwise,
 * round-off errors and other errors will accumulate very quickly
 */

const TRUCK_MODEL_URL = "resources/truck/truck.gltf";
const TRUCK_DESTROYED_MODEL_URL = "resources/truck_destroyed/truck.gltf";
const PROJECTILE_MODEL_URL = "resources/box/box.gltf";
const FIRE_URL = "resources/fire.png";
const SMOKE_URL = "resources/smoke.png";
const TICKRATE = 60;
const TICK_INTERVAL = 1000 / TICKRATE;

const DEFAULT_DAMAGE = 10;

// const INITIAL_POS = Cesium.Cartesian3.fromDegrees(-112.173774, 36.175399);  // grand canyon
const INITIAL_POS = Cesium.Cartesian3.fromDegrees(-77.413404, 43.203573);   // webster
const INITIAL_ORIENT = Cesium.Transforms.headingPitchRollQuaternion(INITIAL_POS,
    new Cesium.HeadingPitchRoll(0, 0, 0));
const FORWARD_ACCEL = 50;
const BACKWARD_ACCEL = 80;
const MAX_FORWARD_SPEED = 100;
const MAX_REVERSE_SPEED = 40;
const GRAVITY = 30; // 9.8 makes the truck take too long to fall

// leaving out next line will result in console warning
Cesium.BingMapsApi.defaultKey = 'P9gVFeINebTgcj5ONynB~sa3kfugY4uM70j48aMFH-g~Ai2zw5GpzAt7hLyv87kHTaDy9dhktuwKhkBi8HyCOoaU5f1VrSm9-Ps4QEJQRuH8';
let viewer = new Cesium.Viewer("cesium-container", {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    shadows: true
});

let terrainProvider = new Cesium.CesiumTerrainProvider({
    url : 'https://assets.agi.com/stk-terrain/v1/tilesets/world/tiles'
});
viewer.terrainProvider = terrainProvider;
viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

/*
 * note: for orientationMatrix from quaternion:
 * col 0 = unit vector forward
 * col 1 = unit vector to left
 * col 2 = unit vector straight up
 */
class Truck {
    constructor(truckEntity) {
        this.entity = truckEntity;
        this.fireParticles = null;
        this.smokeParticles = null;

        this.health = 100;
        this.entity = truckEntity;
        this.vel = new Cesium.Cartesian3();
        this.forward = false;
        this.backward = false;
        this.left = false;
        this.right = false;
        this.damage = DEFAULT_DAMAGE;
        this.destroyed = false;
    }

    driveTick() {
        let entity = this.entity;

        let pos0 = entity.position._value;
        let pos0Carto = Cesium.Cartographic.fromCartesian(pos0);
        let groundHeight = Cesium.defaultValue(viewer.scene.globe.getHeight(pos0Carto), 0);
        let speed = Cesium.Cartesian3.magnitude(this.vel);

        let isAirborne = pos0Carto.height - groundHeight > 0.3;
        let orientationMatrix = Cesium.Matrix3.fromQuaternion(entity.orientation._value, new Cesium.Matrix3());
        let forwardDir = Cesium.Matrix3.getColumn(orientationMatrix, 0, new Cesium.Cartesian3());
        let leftDir = Cesium.Matrix3.getColumn(orientationMatrix, 1, new Cesium.Cartesian3());
        let upDir = Cesium.Matrix3.getColumn(orientationMatrix, 2, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.magnitude(forwardDir) > 1.01 ||
            Cesium.Cartesian3.magnitude(leftDir) > 1.01 ||
            Cesium.Cartesian3.magnitude(upDir) > 1.01) {
            console.log("STOP STOP STOP STOP STOP STOP STOP");
        }

        let steerAngle = 0;

        // steering: degrade turning at higher speeds
        if (this.left || this.right) {
            let TURN_SPEED_MIN = 60;        // radian/sec
            let TURN_SPEED_MAX = 100;       // radian/sec

            let turnSpeed;

            // turn speed calculations adapted from monster milktruck
            let SPEED_MAX_TURN = 25;
            let SPEED_MIN_TURN = 120;
            if (speed < SPEED_MAX_TURN) {
                turnSpeed = TURN_SPEED_MIN + (TURN_SPEED_MAX - TURN_SPEED_MIN) * (SPEED_MAX_TURN - speed) / SPEED_MAX_TURN;
                turnSpeed *= (speed / SPEED_MAX_TURN);
            } else if (speed < SPEED_MIN_TURN) {
                turnSpeed = TURN_SPEED_MIN + (TURN_SPEED_MAX - TURN_SPEED_MIN) * (SPEED_MIN_TURN - speed) / (SPEED_MIN_TURN - SPEED_MAX_TURN);
            } else {
                turnSpeed = TURN_SPEED_MIN;
            }
            if (truck.left) {
                steerAngle = turnSpeed * dt * Math.PI / 180;
            }
            if (truck.right) {
                steerAngle = -turnSpeed * dt * Math.PI / 180;
            }
        }

        // turn the car, update forward, left, and up orthonormal vectors
        forwardDir = isAirborne ? forwardDir : rotate(forwardDir, upDir, steerAngle);
        leftDir = Cesium.Cartesian3.cross(upDir, forwardDir, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(forwardDir, forwardDir);
        Cesium.Cartesian3.normalize(leftDir, leftDir);
        Cesium.Matrix3.setColumn(orientationMatrix, 0, forwardDir, orientationMatrix);
        Cesium.Matrix3.setColumn(orientationMatrix, 1, leftDir, orientationMatrix);
        // entity.orientation = Cesium.Quaternion.fromRotationMatrix(orientationMatrix);

        // calculate forward speed
        let forwardSpeed = 0;
        if (!isAirborne) {
            // dampen sideways slip
            let slipMagnitude = Cesium.Cartesian3.dot(this.vel, leftDir);
            let c0 = Math.exp(-dt / 0.5);
            let slipVector = Cesium.Cartesian3.multiplyByScalar(leftDir, slipMagnitude * (1 - c0), new Cesium.Cartesian3());
            Cesium.Cartesian3.subtract(this.vel, slipVector, this.vel);

            // accelerate forwards
            forwardSpeed = Cesium.Cartesian3.dot(forwardDir, this.vel);
            if (truck.forward) {
                let accelAmount = Cesium.Cartesian3.multiplyByScalar(forwardDir, FORWARD_ACCEL * dt, new Cesium.Cartesian3());
                Cesium.Cartesian3.add(this.vel, accelAmount, this.vel);
            } else if (truck.backward) {
                if (forwardSpeed > -MAX_REVERSE_SPEED) {
                    let accelAmount = Cesium.Cartesian3.multiplyByScalar(forwardDir, -BACKWARD_ACCEL * dt, new Cesium.Cartesian3());
                    Cesium.Cartesian3.add(this.vel, accelAmount, this.vel);
                }
            }
        }

        // air resistance
        speed = Cesium.Cartesian3.magnitude(this.vel);
        if (speed > 0.01) {
            let velDir = Cesium.Cartesian3.normalize(this.vel, new Cesium.Cartesian3());
            let DRAG_FACTOR = 0.00090;
            let drag = speed * speed * DRAG_FACTOR;

            // extra constant drag to make sure truck eventually stops
            let CONSTANT_DRAG = 1.5;
            drag += CONSTANT_DRAG;

            if (drag > speed) {
                drag = speed;
            }

            let dragVector = Cesium.Cartesian3.multiplyByScalar(velDir, drag * dt, new Cesium.Cartesian3());
            Cesium.Cartesian3.subtract(this.vel, dragVector, this.vel);
        }

        // gravity
        let gravNormal = viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(pos0);
        let upAccel = Cesium.Cartesian3.multiplyByScalar(gravNormal, -GRAVITY * dt, new Cesium.Cartesian3());
        Cesium.Cartesian3.add(this.vel, upAccel, this.vel);

        // move truck after velocity vector is completely calculated
        let deltaPos = Cesium.Cartesian3.multiplyByScalar(this.vel, dt, new Cesium.Cartesian3());
        let pos1 = Cesium.Cartesian3.add(pos0, deltaPos, new Cesium.Cartesian3());

        // check that we're not underground
        let pos1Carto = Cesium.Cartographic.fromCartesian(pos1);
        groundHeight = Cesium.defaultValue(viewer.scene.globe.getHeight(pos1Carto), 0);
        if (pos1Carto.height < groundHeight) {
            pos1 = Cesium.Cartesian3.fromRadians(pos1Carto.longitude, pos1Carto.latitude, groundHeight);
            pos1Carto.height = groundHeight;
        }

        // cancel velocity into ground
        if (!isAirborne) {
            let groundNormal = estimateGroundNormal(pos1);
            let speedOutOfGround = Cesium.Cartesian3.dot(groundNormal, this.vel);
            if (speedOutOfGround < 0) {
                let cancel = Cesium.Cartesian3.multiplyByScalar(groundNormal, -speedOutOfGround, new Cesium.Cartesian3());
                Cesium.Cartesian3.add(this.vel, cancel, this.vel);
            }

            // make orientation match ground
            // c0 := "what percent of my new upDir should match my original upDir in this tick"
            // c1 := "what percent of my new upDir should match the groundNormal in this tick"
            let c0 = 0.9;
            let c1 = 1 - c0;
            let scaledUp = Cesium.Cartesian3.multiplyByScalar(upDir, c0, new Cesium.Cartesian3());
            let scaledNormal = Cesium.Cartesian3.multiplyByScalar(groundNormal, c1, new Cesium.Cartesian3());
            let blendedUp = Cesium.Cartesian3.add(scaledUp, scaledNormal, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(blendedUp, blendedUp);

            // make sure vectors are orthonormal
            let newForward = Cesium.Cartesian3.cross(leftDir, blendedUp, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(newForward, newForward);
            let newLeft = Cesium.Cartesian3.cross(blendedUp, newForward, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(newLeft, newLeft);
            let newUp = Cesium.Cartesian3.cross(newForward, newLeft, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(newUp, newUp);
            Cesium.Matrix3.setColumn(orientationMatrix, 0, newForward, orientationMatrix);
            Cesium.Matrix3.setColumn(orientationMatrix, 1, newLeft, orientationMatrix);
            Cesium.Matrix3.setColumn(orientationMatrix, 2, newUp, orientationMatrix);
        }

        entity.position = pos1;
        entity.orientation = Cesium.Quaternion.fromRotationMatrix(orientationMatrix);
        
        this.cameraTick();
    }

    particleTick() {
        if (this.fireParticles) {
            let matrix = computeModelMatrix(this.entity);
            this.fireParticles.modelMatrix = matrix;
            this.smokeParticles.modelMatrix = matrix;
        }
    }

    cameraTick() {
        let hpr = Cesium.HeadingPitchRoll.fromQuaternion(this.entity.orientation._value);
        viewer.scene.camera.lookAt(this.entity.position._value,
            new Cesium.HeadingPitchRange(hpr.heading + Math.PI / 2, -0.1, 50));
    }
}

/**
 * Rotates the given vector about the given axis by the given amount of radians
 * @param {Cesium.Cartesian3} vector the vector to rotate
 * @param {Cesium.Cartesian3} axis the axis of rotation
 * @param {Number} radians the amount to rotate in radians
 * @returns {Cesium.Cartesian3} a new Cesium.Cartesian3 representing the rotated vector
 */
function rotate(vector, axis, radians) {
    let quaternion = Cesium.Quaternion.fromAxisAngle(axis, radians);
    let rotationMatrix = Cesium.Matrix3.fromQuaternion(quaternion);
    return Cesium.Matrix3.multiplyByVector(rotationMatrix, vector, new Cesium.Cartesian3());
}

/**
 * Calculates the normal vector of the terrain at the given position.
 * Estimation is done by taking 4 height samples around the given position
 * @param {Cesium.Cartesian3} pos the position that we want to estimate the ground normal of
 * @returns {Cesium.Cartesian3} the normal vector of the terrain at pos
 */
function estimateGroundNormal(pos) {
    let globe = viewer.scene.globe;

    let frame = Cesium.Transforms.eastNorthUpToFixedFrame(pos, globe.ellipsoid);
    let east = Cesium.Cartesian3.fromCartesian4(Cesium.Matrix4.getColumn(frame, 0, new Cesium.Cartesian4()));
    let north = Cesium.Cartesian3.fromCartesian4(Cesium.Matrix4.getColumn(frame, 1, new Cesium.Cartesian4()));

    let pos0 = Cesium.Cartesian3.add(pos, east, new Cesium.Cartesian3());
    let pos1 = Cesium.Cartesian3.subtract(pos, east, new Cesium.Cartesian3());
    let pos2 = Cesium.Cartesian3.add(pos, north, new Cesium.Cartesian3());
    let pos3 = Cesium.Cartesian3.subtract(pos, north, new Cesium.Cartesian3());

    let h0 = Cesium.defaultValue(globe.getHeight(Cesium.Cartographic.fromCartesian(pos0)), 0);
    let h1 = Cesium.defaultValue(globe.getHeight(Cesium.Cartographic.fromCartesian(pos1)), 0);
    let h2 = Cesium.defaultValue(globe.getHeight(Cesium.Cartographic.fromCartesian(pos2)), 0);
    let h3 = Cesium.defaultValue(globe.getHeight(Cesium.Cartographic.fromCartesian(pos3)), 0);

    let dx = h1 - h0;
    let dy = h3 - h2;
    let normal = new Cesium.Cartesian3(dx, dy, 2);
    Cesium.Cartesian3.normalize(normal, normal);
    
    Cesium.Matrix4.multiplyByPointAsVector(frame, normal, normal);
    return normal;
}

/**
 * Updates visual indications of truck's health (html/css, visible damage, etc.)
 */
function updateHealthBar() {
    if (truck.destroyed) { return; }
    let remaining = Math.max(truck.health * 2, 0);
    $("#health-num").text(Math.floor(truck.health));
    $("#health-remaining").width(remaining + "px");
    if (truck.health <= 40) {
        truck.entity.model.uri = TRUCK_DESTROYED_MODEL_URL;
        if (!truck.fireParticles) {
            truck.fireParticles = viewer.scene.primitives.add(new Cesium.ParticleSystem({
                image: FIRE_URL,
                startScale: 1,
                endScale: 4,
                life: 1,
                speed: 5,
                width: 20,
                height: 20,
                rate: 10,
                lifeTime: 16,
                modelMatrix: computeModelMatrix(truck.entity),
                emitterModelMatrix: computeEmitterModelMatrix()
            }));
            truck.smokeParticles = viewer.scene.primitives.add(new Cesium.ParticleSystem({
                image: SMOKE_URL,
                startScale: 1,
                endScale: 4,
                life: 1,
                speed: 5,
                width: 20,
                height: 20,
                rate: 10,
                lifeTime: 16,
                modelMatrix: computeModelMatrix(truck.entity),
                emitterModelMatrix: computeEmitterModelMatrix()
            }));
        }
    }
    if (truck.health <= 0) {
        truck.destroyed = true;
        let matrix = computeModelMatrix(truck.entity);
        viewer.scene.primitives.add(new Cesium.ParticleSystem({
            image: FIRE_URL,
            startScale: 1,
            endScale: 4,
            startColor: Cesium.Color.RED.withAlpha(0.7),
            endColor: Cesium.Color.YELLOW.withAlpha(0.3),
            life: 0.5,
            speed: 20,
            width: 20,
            height: 20,
            rate: 200,
            lifeTime: 1,
            loop: false,
            modelMatrix: matrix,
            emitterModelMatrix: computeEmitterModelMatrix(),
            emitter: new Cesium.SphereEmitter(1.0)
        }));
        viewer.scene.primitives.add(new Cesium.ParticleSystem({
            image: SMOKE_URL,
            startScale: 1,
            endScale: 4,
            life: 0.5,
            speed: 20,
            width: 20,
            height: 20,
            rate: 200,
            lifeTime: 1,
            loop: false,
            modelMatrix: matrix,
            emitterModelMatrix: computeEmitterModelMatrix(),
            emitter: new Cesium.SphereEmitter(1.0)
        }));
        viewer.entities.remove(truck.entity);
        viewer.scene.primitives.remove(truck.fireParticles);
        viewer.scene.primitives.remove(truck.smokeParticles);
        $("#wrecked-text").text("wrecked.");
        $("#wrecked-message").text("(reload page to try again)");
        socket.emit("clientDestroyed", userId);
    }
}

function tick() {
    if (!truck.destroyed) {
        truck.driveTick();
        truck.particleTick();
    }
    updateHealthBar();
    socket.emit("serverReceivesClientData",
        userId,
        truck.entity.position._value,
        truck.entity.orientation._value);
}

function fireProjectile() {
    // bullet should fire from front-middle of truck (about 1 meter in front and 1.5 meters off the ground);
    let height = Cesium.Cartographic.fromCartesian(truck.entity.position._value).height + 1.5;
    let forwardDir = Cesium.Matrix3.getColumn(Cesium.Matrix3.fromQuaternion(truck.entity.orientation._value), 0, new Cesium.Cartesian3());
    let deltaPos = Cesium.Cartesian3.multiplyByScalar(forwardDir, 3, new Cesium.Cartesian3());
    let pos = Cesium.Cartesian3.add(truck.entity.position._value, deltaPos, new Cesium.Cartesian3());
    let posCarto = Cesium.Cartographic.fromCartesian(pos);
    pos = Cesium.Cartesian3.fromRadians(posCarto.longitude, posCarto.latitude, height);
    socket.emit("addNewProjectile", pos, forwardDir, truck.damage);
}

/**
 * Computes the model matrix of the input entity
 * @param {Cesium.Entity} entity the entity to compute the model matrix of
 * @returns the modelMatrix of that entity
 */
function computeModelMatrix(entity) {
    let pos = entity.position._value;
    let rotation = Cesium.Matrix3.fromQuaternion(entity.orientation._value);
    let modelMatrix = Cesium.Matrix4.fromRotationTranslation(rotation, pos, new Cesium.Matrix4());
    return modelMatrix;
}

/**
 * Computes an offset for a particle relative to an entity
 * ex: puts fire particles on engine of truck instead of center of it
 */
function computeEmitterModelMatrix() {
    let hpr = Cesium.HeadingPitchRoll.fromDegrees(0, 0, 0, new Cesium.HeadingPitchRoll);
    let trs = new Cesium.TranslationRotationScale();
    trs.translation = Cesium.Cartesian3.fromElements(2, 0, 1.5, new Cesium.Cartesian3());
    trs.rotation = Cesium.Quaternion.fromHeadingPitchRoll(hpr, new Cesium.Quaternion());
    return Cesium.Matrix4.fromTranslationRotationScale(trs, new Cesium.Matrix4());
}

function frame(timestamp) {
    let now = window.performance.now();
    deltaT += Math.min(1000, now - timestamp);      // cap deltaT at 1 sec in case browser loses focus
    while (deltaT >= TICK_INTERVAL) {
        deltaT -= TICK_INTERVAL;
        tick();
    }
    requestAnimationFrame(frame);
}


$(document).keydown((e) => {
    if (truck.destroyed) { return; }
    let c = e.which;
    if (c == 87) {              // w
        truck.forward = true;
    } else if (c == 65) {       // a
        truck.left = true;
    } else if (c == 83) {       // s
        truck.backward = true;
    } else if (c == 68) {       // d
        truck.right = true;
    } else if (c == 32) {
        fireProjectile();
    }
});

$(document).keyup((e) => {
    if (truck.destroyed) { return; }
    let c = e.which;
    if (c == 87) {              // w
        truck.forward = false;
    } else if (c == 65) {       // a
        truck.left = false;
    } else if (c == 83) {       // s
        truck.backward = false;
    } else if (c == 68) {       // d
        truck.right = false;
    }
});

/* Start Program */

let truckEntity = viewer.entities.add({
    name: "truck",
    model: {
        uri: TRUCK_MODEL_URL,
        scale: 1,
        runAnimations: false
    },
    position: INITIAL_POS,
    orientation: INITIAL_ORIENT
});
let truck = new Truck(truckEntity);

let deltaT = 0;
let start = window.performance.now();
let dt = 1 / TICKRATE;
requestAnimationFrame(frame);

/* Client-Server Communication */

let clientPlayerEntities = {};              // map from player's id to an actual entity
let clientFireParticles = {};               // map from player's id to a Particle System of fire
let clientSmokeParticles = {};              // map from player's id to a Particle System of smoke
let clientProjectileEntities = {};          // map from projectile's id to an actual entity

let userId = ~~(Math.random() * 1000000000);   // userId is just a random number (for now)
let socket = io();

socket.on("serverEmitsData", (PLAYERS_IN_SERVER, PROJECTILES, PROJ_TO_REMOVE) => {
    // update player positions
    for (let playerId in PLAYERS_IN_SERVER) {
        if (playerId == userId) {
            truck.health = PLAYERS_IN_SERVER[playerId].health;
            continue;
        }
        if (clientPlayerEntities[playerId]) {
            let playerEntity = clientPlayerEntities[playerId];
            playerEntity.position = PLAYERS_IN_SERVER[playerId].pos;
            playerEntity.orientation = PLAYERS_IN_SERVER[playerId].orientation;
            if (PLAYERS_IN_SERVER[playerId].health <= 40) {
                playerEntity.model.uri = TRUCK_DESTROYED_MODEL_URL;
                if (clientFireParticles[playerId]) {
                    let matrix = computeModelMatrix(playerEntity);
                    clientFireParticles[playerId].modelMatrix = matrix;
                    clientSmokeParticles[playerId].modelMatrix = matrix;
                } else {
                    clientFireParticles[playerId] = viewer.scene.primitives.add(new Cesium.ParticleSystem({
                        image: FIRE_URL,
                        startScale: 1,
                        endScale: 4,
                        life: 1,
                        speed: 5,
                        width: 20,
                        height: 20,
                        rate: 10,
                        lifeTime: 16,
                        modelMatrix: computeModelMatrix(playerEntity),
                        emitterModelMatrix: computeEmitterModelMatrix()
                    }));
                    clientSmokeParticles[playerId] = viewer.scene.primitives.add(new Cesium.ParticleSystem({
                        image: SMOKE_URL,
                        startScale: 1,
                        endScale: 4,
                        life: 1,
                        speed: 5,
                        width: 20,
                        height: 20,
                        rate: 10,
                        lifeTime: 16,
                        modelMatrix: computeModelMatrix(playerEntity),
                        emitterModelMatrix: computeEmitterModelMatrix()
                    }));
                }
            }
        } else {
            clientPlayerEntities[playerId] = viewer.entities.add({
                name: "truck",
                model: {
                    uri: TRUCK_MODEL_URL,
                    scale: 1,
                    runAnimations: false
                },
                position: PLAYERS_IN_SERVER[playerId].pos,
                orientation: PLAYERS_IN_SERVER[playerId].orientation
            });
        }
    }

    // update projectile positions
    for (let projId in PROJECTILES) {
        if (clientProjectileEntities[projId]) {
            clientProjectileEntities[projId].position = PROJECTILES[projId].pos;
        } else {
            clientProjectileEntities[projId] = viewer.entities.add({
                name: "projectile",
                model: {
                    uri: PROJECTILE_MODEL_URL,
                    scale: 1,
                    runAnimations: false
                },
                position: PROJECTILES[projId].pos,
                orientation: INITIAL_ORIENT
            });
        }
    }

    // remove old projectiles
    for (let i = 0; i < PROJ_TO_REMOVE.length; i++) {
        let id = PROJ_TO_REMOVE[i];
        if (clientProjectileEntities[id]) {
            viewer.entities.remove(clientProjectileEntities[id]);
            delete clientProjectileEntities[id];
        }
    }
});

/**
 * note: we needed to add a "special event" for when a player is destroyed
 * because when a player is destroyed, they are immediately deleted from the
 * server. Thus, we need a separate way to inform everyone that it is destroyed;
 */
socket.on("playerDestroyed", (playerId) => {
    if (playerId == userId) {
        truck.health = 0;
        return;
    }
    if (!clientPlayerEntities[playerId]) { return; }
    let playerEntity = clientPlayerEntities[playerId];
    let matrix = computeModelMatrix(playerEntity);
    let tempFire = viewer.scene.primitives.add(new Cesium.ParticleSystem({
        image: FIRE_URL,
        startScale: 1,
        endScale: 4,
        startColor: Cesium.Color.RED.withAlpha(0.7),
        endColor: Cesium.Color.YELLOW.withAlpha(0.3),
        life: 0.5,
        speed: 20,
        width: 20,
        height: 20,
        rate: 200,
        lifeTime: 1,
        loop: false,
        modelMatrix: matrix,
        emitterModelMatrix: computeEmitterModelMatrix(),
        emitter: new Cesium.SphereEmitter(1.0)
    }));
    let tempSmoke = viewer.scene.primitives.add(new Cesium.ParticleSystem({
        image: SMOKE_URL,
        startScale: 1,
        endScale: 4,
        life: 0.5,
        speed: 20,
        width: 20,
        height: 20,
        rate: 200,
        lifeTime: 1,
        loop: false,
        modelMatrix: matrix,
        emitterModelMatrix: computeEmitterModelMatrix(),
        emitter: new Cesium.SphereEmitter(1.0)
    }));
    viewer.entities.remove(playerEntity);
    viewer.scene.primitives.remove(clientFireParticles[playerId]);
    viewer.scene.primitives.remove(clientSmokeParticles[playerId]);
    tempFire.complete = () => { console.log("event fired"); }
    tempSmoke.complete = () => { console.log("event fired 2"); }
    delete clientPlayerEntities[playerId];
    delete clientFireParticles[playerId];
    delete clientSmokeParticles[playerId];
});

socket.emit("playerConnect",
    userId,
    truck.entity.position._value,
    truck.entity.orientation._value,
    truck.health);
    