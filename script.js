const camera = document.getElementById("camera");
const fogCanvas = document.getElementById("fogCanvas");
const handCanvas = document.getElementById("handCanvas");

const fogCtx = fogCanvas.getContext("2d");
const handCtx = handCanvas.getContext("2d");

const fogCanvasMask = document.createElement("canvas");
const fogMaskCtx = fogCanvasMask.getContext("2d");

let faceLandmarker = null;
let handLandmarker = null;

let cameraRunning = false;
let fogActive = false;

let lastVideoTime = -1;

let lastFogTrigger = 0;
let mouthOpenSince = 0;


/* =========================================================
   WRITING SETTINGS
   ========================================================= */

const WRITING = {

    /* Smoothness */
    smoothing: 0.18,

    /* Tiny movement ignored */
    deadZone: 0.7,

    /* Smaller = more continuous */
    pathSpacing: 1.5,

    /* Writing thickness */
    brushRadius: 13,

    /* Prevent tracking jumps */
    maxJump: 35
};


/* =========================================================
   PALM RUB SETTINGS
   ========================================================= */

const PALM_RUB = {

    /* Palm movement smoothing */
    smoothing: 0.20,

    /* Size of local rub */
    radius: 75,

    /* Ignore tiny movement */
    deadZone: 2,

    /* Smooth continuous rubbing */
    pathSpacing: 4,

    /* Prevent huge accidental wipe */
    maxJump: 90
};


/* =========================================================
   INDEX WRITING STATE
   ========================================================= */

let fingerX = null;
let fingerY = null;

let smoothFingerX = null;
let smoothFingerY = null;

let lastDrawX = null;
let lastDrawY = null;


/* =========================================================
   PALM RUB STATE
   ========================================================= */

let palmX = null;
let palmY = null;

let smoothPalmX = null;
let smoothPalmY = null;

let lastPalmX = null;
let lastPalmY = null;


/* =========================================================
   HAND LOST STATE
   ========================================================= */

let fingerLostFrames = 0;


/* =========================================================
   RESIZE CANVASES
   ========================================================= */

function resizeCanvases() {

    const width = window.innerWidth;
    const height = window.innerHeight;

    fogCanvas.width = width;
    fogCanvas.height = height;

    handCanvas.width = width;
    handCanvas.height = height;

    fogCanvasMask.width = width;
    fogCanvasMask.height = height;

    if (fogActive) {
        createFog();
    }
}

window.addEventListener(
    "resize",
    resizeCanvases
);


/* =========================================================
   DISTANCE
   ========================================================= */

function distance(a, b) {

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(
        dx * dx +
        dy * dy
    );
}


/* =========================================================
   POINT DISTANCE
   ========================================================= */

function pointDistance(
    x1,
    y1,
    x2,
    y2
) {

    const dx = x2 - x1;
    const dy = y2 - y1;

    return Math.sqrt(
        dx * dx +
        dy * dy
    );
}


/* =========================================================
   ANGLE
   ========================================================= */

function angle(a, b, c) {

    const abx = a.x - b.x;
    const aby = a.y - b.y;

    const cbx = c.x - b.x;
    const cby = c.y - b.y;

    const dot =
        abx * cbx +
        aby * cby;

    const magnitude =
        Math.sqrt(
            abx * abx +
            aby * aby
        ) *
        Math.sqrt(
            cbx * cbx +
            cby * cby
        );

    if (magnitude === 0) {
        return 0;
    }

    const value =
        Math.max(
            -1,
            Math.min(
                1,
                dot / magnitude
            )
        );

    return (
        Math.acos(value) *
        180 /
        Math.PI
    );
}


/* =========================================================
   INDEX FINGER EXTENDED
   ========================================================= */

function isIndexFingerExtended(hand) {

    if (
        !hand ||
        hand.length < 21
    ) {
        return false;
    }

    const wrist = hand[0];

    const indexMCP = hand[5];
    const indexPIP = hand[6];
    const indexTip = hand[8];

    const fingerAngle =
        angle(
            indexMCP,
            indexPIP,
            indexTip
        );

    const tipDistance =
        distance(
            indexTip,
            wrist
        );

    const pipDistance =
        distance(
            indexPIP,
            wrist
        );

    return (
        fingerAngle > 135 &&
        tipDistance >
        pipDistance * 1.03
    );
}


/* =========================================================
   GENERIC FINGER EXTENDED
   ========================================================= */

function isFingerExtended(
    hand,
    mcpIndex,
    pipIndex,
    tipIndex
) {

    const mcp = hand[mcpIndex];
    const pip = hand[pipIndex];
    const tip = hand[tipIndex];
    const wrist = hand[0];

    if (
        !mcp ||
        !pip ||
        !tip ||
        !wrist
    ) {
        return false;
    }

    const fingerAngle =
        angle(
            mcp,
            pip,
            tip
        );

    const tipDistance =
        distance(
            tip,
            wrist
        );

    const pipDistance =
        distance(
            pip,
            wrist
        );

    return (
        fingerAngle > 145 &&
        tipDistance >
        pipDistance * 1.04
    );
}


/* =========================================================
   FIVE FINGER OPEN PALM
   ========================================================= */

function isFiveFingersOpen(hand) {

    if (
        !hand ||
        hand.length < 21
    ) {
        return false;
    }

    /* INDEX */

    const indexOpen =
        isFingerExtended(
            hand,
            5,
            6,
            8
        );


    /* MIDDLE */

    const middleOpen =
        isFingerExtended(
            hand,
            9,
            10,
            12
        );


    /* RING */

    const ringOpen =
        isFingerExtended(
            hand,
            13,
            14,
            16
        );


    /* PINKY */

    const pinkyOpen =
        isFingerExtended(
            hand,
            17,
            18,
            20
        );


    /* THUMB */

    const thumbTip = hand[4];
    const thumbIP = hand[3];
    const thumbMCP = hand[2];
    const wrist = hand[0];

    const thumbAngle =
        angle(
            thumbMCP,
            thumbIP,
            thumbTip
        );

    const thumbTipDistance =
        distance(
            thumbTip,
            wrist
        );

    const thumbIPDistance =
        distance(
            thumbIP,
            wrist
        );

    const thumbOpen =
        thumbAngle > 125 &&
        thumbTipDistance >
        thumbIPDistance * 1.03;


    return (
        indexOpen &&
        middleOpen &&
        ringOpen &&
        pinkyOpen &&
        thumbOpen
    );
}


/* =========================================================
   ORIGINAL FOG
   ========================================================= */

function createFog() {

    const width =
        fogCanvasMask.width;

    const height =
        fogCanvasMask.height;

    fogMaskCtx.globalCompositeOperation =
        "source-over";

    fogMaskCtx.clearRect(
        0,
        0,
        width,
        height
    );


    /* ORIGINAL BASE FOG */

    const base =
        fogMaskCtx.createLinearGradient(
            0,
            0,
            0,
            height
        );

    base.addColorStop(
        0,
        "rgba(215,222,226,0.42)"
    );

    base.addColorStop(
        0.25,
        "rgba(235,239,241,0.62)"
    );

    base.addColorStop(
        0.50,
        "rgba(242,245,246,0.70)"
    );

    base.addColorStop(
        0.75,
        "rgba(225,232,235,0.61)"
    );

    base.addColorStop(
        1,
        "rgba(195,205,210,0.43)"
    );

    fogMaskCtx.fillStyle =
        base;

    fogMaskCtx.fillRect(
        0,
        0,
        width,
        height
    );


    /* ORIGINAL CLOUD PARTICLES */

    for (
        let i = 0;
        i < 150;
        i++
    ) {

        const x =
            Math.random() *
            width;

        const y =
            Math.random() *
            height;

        const radius =
            25 +
            Math.random() *
            130;

        const opacity =
            0.025 +
            Math.random() *
            0.07;

        const cloud =
            fogMaskCtx.createRadialGradient(
                x,
                y,
                0,
                x,
                y,
                radius
            );

        cloud.addColorStop(
            0,
            `rgba(255,255,255,${opacity})`
        );

        cloud.addColorStop(
            0.5,
            `rgba(235,242,245,${opacity * 0.55})`
        );

        cloud.addColorStop(
            1,
            "rgba(255,255,255,0)"
        );

        fogMaskCtx.fillStyle =
            cloud;

        fogMaskCtx.beginPath();

        fogMaskCtx.arc(
            x,
            y,
            radius,
            0,
            Math.PI * 2
        );

        fogMaskCtx.fill();
    }


    /* ORIGINAL BREATH AREA */

    const breathX =
        width *
        (
            0.45 +
            Math.random() * 0.10
        );

    const breathY =
        height *
        (
            0.48 +
            Math.random() * 0.08
        );

    const breath =
        fogMaskCtx.createRadialGradient(
            breathX,
            breathY,
            10,
            breathX,
            breathY,
            Math.min(
                width,
                height
            ) * 0.42
        );

    breath.addColorStop(
        0,
        "rgba(255,255,255,0.16)"
    );

    breath.addColorStop(
        0.4,
        "rgba(245,248,249,0.09)"
    );

    breath.addColorStop(
        1,
        "rgba(255,255,255,0)"
    );

    fogMaskCtx.fillStyle =
        breath;

    fogMaskCtx.fillRect(
        0,
        0,
        width,
        height
    );

    fogActive = true;

    resetWritingState();
    resetPalmState();
}


/* =========================================================
   RESET WRITING
   ========================================================= */

function resetWritingState() {

    fingerX = null;
    fingerY = null;

    smoothFingerX = null;
    smoothFingerY = null;

    lastDrawX = null;
    lastDrawY = null;
}


/* =========================================================
   RESET PALM
   ========================================================= */

function resetPalmState() {

    palmX = null;
    palmY = null;

    smoothPalmX = null;
    smoothPalmY = null;

    lastPalmX = null;
    lastPalmY = null;
}


/* =========================================================
   TRIGGER FOG
   ========================================================= */

function triggerFog() {

    const now =
        performance.now();

    if (
        now -
        lastFogTrigger <
        1400
    ) {
        return;
    }

    lastFogTrigger =
        now;

    createFog();
}


/* =========================================================
   INDEX WRITING BRUSH
   ========================================================= */

function wipeAt(
    x,
    y,
    radius = WRITING.brushRadius
) {

    if (!fogActive) {
        return;
    }

    fogMaskCtx.globalCompositeOperation =
        "destination-out";

    const gradient =
        fogMaskCtx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            radius
        );

    gradient.addColorStop(
        0,
        "rgba(0,0,0,1)"
    );

    gradient.addColorStop(
        0.45,
        "rgba(0,0,0,0.98)"
    );

    gradient.addColorStop(
        0.68,
        "rgba(0,0,0,0.78)"
    );

    gradient.addColorStop(
        0.86,
        "rgba(0,0,0,0.30)"
    );

    gradient.addColorStop(
        1,
        "rgba(0,0,0,0)"
    );

    fogMaskCtx.fillStyle =
        gradient;

    fogMaskCtx.beginPath();

    fogMaskCtx.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
    );

    fogMaskCtx.fill();

    fogMaskCtx.globalCompositeOperation =
        "source-over";
}


/* =========================================================
   SMOOTH WRITING PATH
   ========================================================= */

function wipePath(
    x1,
    y1,
    x2,
    y2
) {

    const d =
        pointDistance(
            x1,
            y1,
            x2,
            y2
        );

    if (
        d >
        WRITING.maxJump
    ) {

        wipeAt(
            x2,
            y2
        );

        return;
    }

    const steps =
        Math.max(
            1,
            Math.ceil(
                d /
                WRITING.pathSpacing
            )
        );

    for (
        let i = 0;
        i <= steps;
        i++
    ) {

        const t =
            i / steps;

        /*
         * Smoothstep.
         */

        const smoothT =
            t *
            t *
            (
                3 -
                2 * t
            );

        const x =
            x1 +
            (
                x2 -
                x1
            ) *
            smoothT;

        const y =
            y1 +
            (
                y2 -
                y1
            ) *
            smoothT;

        wipeAt(
            x,
            y
        );
    }
}


/* =========================================================
   PALM RUB BRUSH
   ========================================================= */

function palmWipeAt(
    x,
    y,
    radius = PALM_RUB.radius
) {

    if (!fogActive) {
        return;
    }

    fogMaskCtx.globalCompositeOperation =
        "destination-out";


    /*
     * Large soft feathered area.
     */

    const gradient =
        fogMaskCtx.createRadialGradient(
            x,
            y,
            radius * 0.05,
            x,
            y,
            radius
        );


    /*
     * Strong center.
     */

    gradient.addColorStop(
        0,
        "rgba(0,0,0,0.96)"
    );


    /*
     * Soft middle.
     */

    gradient.addColorStop(
        0.30,
        "rgba(0,0,0,0.82)"
    );

    gradient.addColorStop(
        0.52,
        "rgba(0,0,0,0.58)"
    );


    /*
     * Feathered edge.
     */

    gradient.addColorStop(
        0.75,
        "rgba(0,0,0,0.25)"
    );

    gradient.addColorStop(
        1,
        "rgba(0,0,0,0)"
    );


    fogMaskCtx.fillStyle =
        gradient;

    fogMaskCtx.beginPath();

    fogMaskCtx.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
    );

    fogMaskCtx.fill();

    fogMaskCtx.globalCompositeOperation =
        "source-over";
}


/* =========================================================
   PALM RUB PATH
   ========================================================= */

function palmWipePath(
    x1,
    y1,
    x2,
    y2
) {

    const d =
        pointDistance(
            x1,
            y1,
            x2,
            y2
        );


    if (
        d >
        PALM_RUB.maxJump
    ) {

        palmWipeAt(
            x2,
            y2
        );

        return;
    }


    const steps =
        Math.max(
            1,
            Math.ceil(
                d /
                PALM_RUB.pathSpacing
            )
        );


    for (
        let i = 0;
        i <= steps;
        i++
    ) {

        const t =
            i / steps;

        const x =
            x1 +
            (
                x2 -
                x1
            ) *
            t;

        const y =
            y1 +
            (
                y2 -
                y1
            ) *
            t;

        palmWipeAt(
            x,
            y
        );
    }
}


/* =========================================================
   PALM CENTER
   ========================================================= */

function getPalmCenter(hand) {

    /*
     * Wrist + four MCP joints.
     * Much more stable than using fingertips.
     */

    const points = [
        hand[0],
        hand[5],
        hand[9],
        hand[13],
        hand[17]
    ];


    let totalX = 0;
    let totalY = 0;


    for (
        const point
        of points
    ) {

        totalX += point.x;
        totalY += point.y;
    }


    return {

        x:
            totalX /
            points.length,

        y:
            totalY /
            points.length
    };
}


/* =========================================================
   PROCESS INDEX WRITING
   ========================================================= */

function processIndexWriting(hand) {

    const tip =
        hand[8];


    /*
     * Mirror X because camera is mirrored.
     */

    const targetX =
        (
            1 -
            tip.x
        ) *
        handCanvas.width;

    const targetY =
        tip.y *
        handCanvas.height;


    /*
     * First frame.
     */

    if (
        smoothFingerX === null ||
        smoothFingerY === null
    ) {

        smoothFingerX =
            targetX;

        smoothFingerY =
            targetY;

    } else {

        const movement =
            pointDistance(
                smoothFingerX,
                smoothFingerY,
                targetX,
                targetY
            );


        /*
         * Dynamic smoothing.
         *
         * Slow movement:
         * very smooth.
         *
         * Fast movement:
         * more responsive.
         */

        let smoothing =
            WRITING.smoothing;


        if (
            movement > 18
        ) {

            smoothing =
                0.30;

        } else if (
            movement > 8
        ) {

            smoothing =
                0.23;

        } else if (
            movement < 3
        ) {

            smoothing =
                0.12;
        }


        smoothFingerX +=
            (
                targetX -
                smoothFingerX
            ) *
            smoothing;


        smoothFingerY +=
            (
                targetY -
                smoothFingerY
            ) *
            smoothing;
    }


    /*
     * Remove tiny tracking jitter.
     */

    if (
        fingerX !== null &&
        fingerY !== null
    ) {

        const movement =
            pointDistance(
                fingerX,
                fingerY,
                smoothFingerX,
                smoothFingerY
            );

        if (
            movement <
            WRITING.deadZone
        ) {
            return;
        }
    }


    fingerX =
        smoothFingerX;

    fingerY =
        smoothFingerY;


    /*
     * Start a new writing stroke.
     */

    if (
        lastDrawX === null ||
        lastDrawY === null
    ) {

        wipeAt(
            fingerX,
            fingerY,
            WRITING.brushRadius + 1
        );

    } else {

        /*
         * Continuous smooth writing.
         */

        wipePath(
            lastDrawX,
            lastDrawY,
            fingerX,
            fingerY
        );
    }


    lastDrawX =
        fingerX;

    lastDrawY =
        fingerY;


    /*
     * Extremely subtle fingertip marker.
     */

    handCtx.beginPath();

    handCtx.arc(
        fingerX,
        fingerY,
        2.5,
        0,
        Math.PI * 2
    );

    handCtx.fillStyle =
        "rgba(255,255,255,0.08)";

    handCtx.fill();
}


/* =========================================================
   PROCESS PALM RUB
   ========================================================= */

function processPalmRub(hand) {

    const center =
        getPalmCenter(hand);


    /*
     * Mirror X.
     */

    const targetX =
        (
            1 -
            center.x
        ) *
        handCanvas.width;

    const targetY =
        center.y *
        handCanvas.height;


    /*
     * Smooth palm movement.
     */

    if (
        smoothPalmX === null ||
        smoothPalmY === null
    ) {

        smoothPalmX =
            targetX;

        smoothPalmY =
            targetY;

    } else {

        smoothPalmX +=
            (
                targetX -
                smoothPalmX
            ) *
            PALM_RUB.smoothing;


        smoothPalmY +=
            (
                targetY -
                smoothPalmY
            ) *
            PALM_RUB.smoothing;
    }


    /*
     * Ignore microscopic movement.
     */

    if (
        palmX !== null &&
        palmY !== null
    ) {

        const movement =
            pointDistance(
                palmX,
                palmY,
                smoothPalmX,
                smoothPalmY
            );

        if (
            movement <
            PALM_RUB.deadZone
        ) {
            return;
        }
    }


    palmX =
        smoothPalmX;

    palmY =
        smoothPalmY;


    /*
     * Start palm rub.
     */

    if (
        lastPalmX === null ||
        lastPalmY === null
    ) {

        palmWipeAt(
            palmX,
            palmY
        );

    } else {

        palmWipePath(
            lastPalmX,
            lastPalmY,
            palmX,
            palmY
        );
    }


    lastPalmX =
        palmX;

    lastPalmY =
        palmY;


    /*
     * Very subtle palm indicator.
     */

    handCtx.beginPath();

    handCtx.arc(
        palmX,
        palmY,
        3,
        0,
        Math.PI * 2
    );

    handCtx.fillStyle =
        "rgba(255,255,255,0.05)";

    handCtx.fill();
}


/* =========================================================
   RESET GESTURE STATES
   ========================================================= */

function resetGestureStates() {

    lastDrawX = null;
    lastDrawY = null;

    lastPalmX = null;
    lastPalmY = null;
}


/* =========================================================
   PROCESS HAND
   ========================================================= */

function processHand(result) {

    handCtx.clearRect(
        0,
        0,
        handCanvas.width,
        handCanvas.height
    );


    /*
     * No hand detected.
     */

    if (
        !result ||
        !result.landmarks ||
        result.landmarks.length === 0
    ) {

        fingerLostFrames++;


        if (
            fingerLostFrames > 4
        ) {

            resetGestureStates();

            fingerX = null;
            fingerY = null;

            smoothFingerX = null;
            smoothFingerY = null;

            palmX = null;
            palmY = null;

            smoothPalmX = null;
            smoothPalmY = null;
        }

        return;
    }


    const hand =
        result.landmarks[0];


    fingerLostFrames = 0;


    /* =====================================================
       PRIORITY 1
       OPEN FIVE-FINGER PALM
       ===================================================== */

    if (
        isFiveFingersOpen(hand)
    ) {

        /*
         * Stop writing immediately.
         */

        lastDrawX = null;
        lastDrawY = null;


        /*
         * Palm rub.
         */

        processPalmRub(hand);

        return;
    }


    /* =====================================================
       PRIORITY 2
       INDEX FINGER
       ===================================================== */

    if (
        isIndexFingerExtended(hand)
    ) {

        /*
         * Stop palm rub.
         */

        lastPalmX = null;
        lastPalmY = null;


        /*
         * Index writing.
         */

        processIndexWriting(hand);

        return;
    }


    /* =====================================================
       CLOSED HAND / OTHER GESTURE
       ===================================================== */

    /*
     * DO NOTHING.
     */

    resetGestureStates();
}


/* =========================================================
   DRAW FOG
   ========================================================= */

function drawFog() {

    fogCtx.clearRect(
        0,
        0,
        fogCanvas.width,
        fogCanvas.height
    );


    if (!fogActive) {
        return;
    }


    fogCtx.drawImage(
        fogCanvasMask,
        0,
        0
    );
}


/* =========================================================
   BLOW DETECTION
   ========================================================= */

function detectBlow(faceResult) {

    if (
        !faceResult ||
        !faceResult.faceLandmarks ||
        faceResult.faceLandmarks.length === 0
    ) {
        return;
    }


    const face =
        faceResult.faceLandmarks[0];


    const upper =
        face[13];

    const lower =
        face[14];

    const left =
        face[61];

    const right =
        face[291];


    if (
        !upper ||
        !lower ||
        !left ||
        !right
    ) {
        return;
    }


    const mouthHeight =
        Math.abs(
            lower.y -
            upper.y
        );


    const mouthWidth =
        Math.abs(
            right.x -
            left.x
        );


    const mouthOpen =
        mouthHeight >
        0.025;


    const mouthWide =
        mouthWidth >
        0.10;


    if (
        mouthOpen &&
        mouthWide
    ) {

        if (
            mouthOpenSince === 0
        ) {

            mouthOpenSince =
                performance.now();
        }


        const duration =
            performance.now() -
            mouthOpenSince;


        if (
            duration > 180
        ) {

            triggerFog();
        }

    } else {

        mouthOpenSince = 0;
    }
}


/* =========================================================
   VIDEO PROCESSING
   ========================================================= */

function processVideo() {

    if (!cameraRunning) {
        return;
    }


    const currentTime =
        camera.currentTime;


    if (
        currentTime !== lastVideoTime &&
        camera.readyState >= 2
    ) {

        lastVideoTime =
            currentTime;


        const timestamp =
            performance.now();


        try {

            /* FACE */

            if (faceLandmarker) {

                const faceResult =
                    faceLandmarker.detectForVideo(
                        camera,
                        timestamp
                    );

                detectBlow(
                    faceResult
                );
            }


            /* HAND */

            if (handLandmarker) {

                const handResult =
                    handLandmarker.detectForVideo(
                        camera,
                        timestamp
                    );

                processHand(
                    handResult
                );
            }

        } catch (error) {

            console.error(
                "AI processing error:",
                error
            );
        }
    }


    drawFog();


    requestAnimationFrame(
        processVideo
    );
}


/* =========================================================
   START EXPERIENCE
   ========================================================= */

async function startExperience() {

    const startButton =
        document.getElementById(
            "startButton"
        );

    const startMessage =
        document.getElementById(
            "startMessage"
        );

    const cameraStage =
        document.querySelector(
            ".camera-stage"
        );


    try {

        startButton.disabled =
            true;

        startButton.textContent =
            "LOADING...";


        /* CAMERA */

        const stream =
            await navigator
                .mediaDevices
                .getUserMedia({

                    video: {

                        facingMode:
                            "user",

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        }
                    },

                    audio: false
                });


        camera.srcObject =
            stream;


        await camera.play();


        resizeCanvases();


        /* MEDIAPIPE CHECK */

        if (
            !window.FaceLandmarker ||
            !window.HandLandmarker ||
            !window.FilesetResolver
        ) {

            throw new Error(
                "MediaPipe did not load."
            );
        }


        /* VISION TASKS */

        const vision =
            await window
                .FilesetResolver
                .forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
                );


        /* FACE */

        faceLandmarker =
            await window
                .FaceLandmarker
                .createFromOptions(
                    vision,
                    {

                        baseOptions: {

                            modelAssetPath:
                                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
                        },

                        runningMode:
                            "VIDEO",

                        numFaces:
                            1
                    }
                );


        /* HAND */

        handLandmarker =
            await window
                .HandLandmarker
                .createFromOptions(
                    vision,
                    {

                        baseOptions: {

                            modelAssetPath:
                                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
                        },

                        runningMode:
                            "VIDEO",

                        numHands:
                            1
                    }
                );


        /* READY */

        cameraRunning =
            true;


        cameraStage.classList.add(
            "active"
        );


        startMessage.style.pointerEvents =
            "none";


        startButton.textContent =
            "READY";


        processVideo();

    } catch (error) {

        console.error(
            "FOG-X startup error:",
            error
        );


        startButton.disabled =
            false;

        startButton.textContent =
            "TRY AGAIN";


        alert(
            "FOG-X could not start.\n\n" +
            error.message
        );
    }
}


/* =========================================================
   MEDIAPIPE READY
   ========================================================= */

window.addEventListener(
    "mediapipe-ready",
    () => {

        const startButton =
            document.getElementById(
                "startButton"
            );


        if (!startButton) {

            console.error(
                "Start button not found."
            );

            return;
        }


        startButton.addEventListener(
            "click",
            startExperience
        );
    }
);


/* =========================================================
   INITIAL SETUP
   ========================================================= */

resizeCanvases();


console.log(
    "🌫️ FOG-X ready — original fog + improved gestures"
);