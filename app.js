// ==========================================
// 1. CONFIGURATION & VARIABLES
// ==========================================
const sfxMove    = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-self.mp3');
const sfxCapture = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/capture.mp3');
const sfxEnd     = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/notify.mp3');
const sfxCheck   = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-check.mp3');
const sfxWin     = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/game-end.mp3');

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PROD_BACKEND_URL = "https://dichess.onrender.com";
const SERVER_URL = isLocal ? "http://localhost:8080" : PROD_BACKEND_URL;

const pieceMap = {
    "wK": "♚", "wQ": "♛", "wR": "♜", "wB": "♝", "wN": "♞", "wP": "♟",
    "bK": "♚", "bQ": "♛", "bR": "♜", "bB": "♝", "bN": "♞", "bP": "♟",
    "": ""
};

const pieceImages = {
    "wK": "https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg",
    "wQ": "https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg",
    "wR": "https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg",
    "wB": "https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg",
    "wN": "https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg",
    "wP": "https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg",
    "bK": "https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg",
    "bQ": "https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg",
    "bR": "https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg",
    "bB": "https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg",
    "bN": "https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg",
    "bP": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg"
};

const pieceValues = { 'Q': 9, 'R': 5, 'B': 3, 'N': 3, 'P': 1, 'K': 0 };

const INITIAL_BOARD = [
    ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
    ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
    ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"]
];

const startingCounts = { 'Q': 1, 'R': 2, 'B': 2, 'N': 2, 'P': 8 };

let moveCounter = 1;
let selectedSquare = null;
let boardHistory = [];
let currentViewIndex = -1;
let lastKnownStatus = "White's Turn";
let lastPlayedMove = null;

let myColor = "SPECTATOR";
let matchStarted = false;
let autoAbortTimer = null;
let isGameOverLock = false;

// currentTurnColor: the authoritative source of whose turn it is.
// Set from the server's "currentTurn" field on every MOVE/START/sync.
// Used exclusively for clock ticking — never rely on status text substrings.
let currentTurnColor = "WHITE";

let disconnectInterval = null;
let disconnectBanner = null;

let serverWhiteTimeMs = 600000;
let serverBlackTimeMs = 600000;
let localTimerStartMs = Date.now();
let timerInterval = null;
let stompClient = null;
let heartbeatInterval = null; // Track heartbeat so we can clear it on reconnect

function updateStatusUI(text) {
    lastKnownStatus = text;
    const statusDiv = document.getElementById("status");
    if (myColor === "SPECTATOR") {
        statusDiv.innerHTML = `<span style="color: #f1c40f;">👁️ SPECTATING</span> | ${text}`;
    } else {
        statusDiv.innerText = text;
    }
}

// ==========================================
// 2. INITIALIZATION & LOBBY SYSTEM
// ==========================================
async function joinGame() {
    try {
        let savedToken = localStorage.getItem("chessToken") || "";
        const response = await fetch(`${SERVER_URL}/join?token=${savedToken}`);
        const tokenResponse = await response.text();

        const loadingScreen = document.getElementById("loading-screen");
        if (loadingScreen) loadingScreen.classList.add("fade-out");

        if (tokenResponse.startsWith("WHITE")) {
            myColor = "WHITE";
            localStorage.setItem("chessToken", tokenResponse);
        } else if (tokenResponse.startsWith("BLACK")) {
            myColor = "BLACK";
            localStorage.setItem("chessToken", tokenResponse);
        } else {
            myColor = "SPECTATOR";
        }

        const leftColumn = document.querySelector(".left-column");
        if (myColor === "BLACK") leftColumn.classList.add("flipped-board");

        if (myColor !== "SPECTATOR") {
            updateStatusUI(`You are playing as: ${myColor}`);
            displayOverlay(`<h2>Welcome, ${myColor}</h2><br><button onclick="declareReady()" style="padding:10px 20px; font-size:18px; cursor:pointer;">I am Ready</button>`);
        } else {
            updateStatusUI("Spectating Live Match...");
            displayOverlay(`<h2>👁️ Spectating Mode</h2><p style="font-size: 24px; color: white;">You are watching a live match.</p>`);
            setTimeout(() => hideOverlay(), 3000);
        }
    } catch (error) {
        const loadingText = document.getElementById("loading-text");
        if (loadingText) {
            loadingText.innerText = "Error: Server is currently offline.";
            loadingText.style.color = "#e74c3c";
            document.querySelector(".bouncing-pawn").style.animation = "none";
        }
    }
}

async function declareReady() {
    displayOverlay("Waiting for opponent to ready up...");
    await fetch(`${SERVER_URL}/ready?color=${myColor}`);
}

function connectWebSocket() {
    const socket = new SockJS(`${SERVER_URL}/ws`);
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.heartbeat.outgoing = 20000;
    stompClient.heartbeat.incoming = 20000;

    stompClient.connect({}, function (frame) {
        // Immediately register so the server can cancel any lingering countdown timers
        if (myColor !== "SPECTATOR") {
            stompClient.send("/app/register", {}, myColor);
        }

        stompClient.subscribe('/topic/game', function (message) {
            const data = JSON.parse(message.body);

            // --- DISCONNECT WARNING ---
            if (data.type === "DISCONNECT_WARNING") {
                let countdown = 60;
                clearInterval(disconnectInterval);
                disconnectInterval = setInterval(() => {
                    countdown--;
                    // Show banner immediately (countdown > 0), clear when expired
                    if (countdown > 0) {
                        const targetTimer = document.getElementById(`${data.color}-disconnect`);
                        if (targetTimer) {
                            targetTimer.classList.remove("hidden");
                            targetTimer.innerHTML = `Disconnected!<br>Auto-resign in ${countdown}s`;
                        }
                    } else {
                        clearInterval(disconnectInterval);
                        disconnectInterval = null;
                    }
                }, 1000);
                return;
            }

            // --- CHAT MESSAGE ---
            if (data.type === "CHAT") {
                const msgDiv = document.createElement("div");
                const isSelf = data.sender.toUpperCase() === myColor.toUpperCase();
                msgDiv.className = `chat-msg ${isSelf ? 'self' : 'opponent'}`;
                // Always use innerText for user content to prevent XSS
                msgDiv.innerText = data.message;
                chatMessages.appendChild(msgDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;

                // If chat is collapsed, show an unread badge on the header
                const chatContainer = document.getElementById("chat-container");
                if (chatContainer && chatContainer.classList.contains("collapsed")) {
                    unreadChatCount++;
                    const badge = document.getElementById("chat-unread");
                    if (badge) {
                        badge.textContent = unreadChatCount;
                        badge.classList.add("visible");
                    }
                }
                return;
            }

            // --- RECONNECT SUCCESS ---
            if (data.type === "RECONNECT_SUCCESS") {
                clearInterval(disconnectInterval);
                disconnectInterval = null;
                const targetTimer = document.getElementById(`${data.color}-disconnect`);
                if (targetTimer) {
                    targetTimer.classList.add("hidden");
                    targetTimer.innerText = "";
                }
                return;
            }

            // Hide disconnect banners when the game ends
            if (data.status && (data.status.toUpperCase().includes("WINS") || data.status.toUpperCase().includes("DRAW"))) {
                clearInterval(disconnectInterval);
                disconnectInterval = null;
                const whiteTimer = document.getElementById("WHITE-disconnect");
                const blackTimer = document.getElementById("BLACK-disconnect");
                if (whiteTimer) whiteTimer.classList.add("hidden");
                if (blackTimer) blackTimer.classList.add("hidden");
            }

            if (data.type === "RESET")      executeLocalReset();
            else if (data.type === "START") startOfficialMatch(data);
            else if (data.type === "MOVE")  executeLiveMoveUpdate(data);
            else if (data.type === "KICK")  window.location.reload();
        });

        // Periodic heartbeat to keep the STOMP session registered.
        // Clear the previous interval first to prevent timer leaks on reconnect.
        clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (stompClient && stompClient.connected && myColor !== "SPECTATOR") {
                stompClient.send("/app/register", {}, myColor);
            }
        }, 25000);

    }, function (error) {
        console.log("Connection lost! Attempting to reconnect...");
        document.getElementById("status").innerText = "⚠️ Reconnecting to server...";
        setTimeout(() => {
            connectWebSocket();
            fetchBoard();
        }, 3000);
    });
}

// ==========================================
// 3. MATCH FLOW LOGIC
// ==========================================
function startOfficialMatch(data) {
    isGameOverLock = false;
    matchStarted = true;
    hideOverlay();

    // Initialize the authoritative turn color from the server payload
    if (data && data.currentTurn) {
        currentTurnColor = data.currentTurn; // Should be "WHITE" on a fresh start
    } else {
        currentTurnColor = "WHITE";
    }

    if (myColor !== "SPECTATOR") {
        document.getElementById("match-controls").classList.remove("hidden");
        const abortBtn = document.getElementById("btn-abort");
        if (abortBtn) abortBtn.classList.remove("hidden");
    }

    localTimerStartMs = Date.now();
    startTimers();

    // Auto-abort if no moves are played in 10 seconds of start
    autoAbortTimer = setTimeout(() => {
        if (moveCounter === 1) sendAction("ABORT", true);
    }, 10000);
}

// ==========================================
// CUSTOM PROMISE-BASED CONFIRMATION MODAL
// ==========================================
function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirm-modal");
        document.getElementById("confirm-title").innerText = title;
        document.getElementById("confirm-message").innerText = message;

        const btnYes = document.getElementById("btn-confirm-yes");
        const btnNo  = document.getElementById("btn-confirm-no");

        btnYes.onclick = () => { modal.classList.add("hidden"); resolve(true); };
        btnNo.onclick  = () => { modal.classList.add("hidden"); resolve(false); };

        modal.classList.remove("hidden");
    });
}

async function sendAction(actionType, skipConfirmation = false) {
    if (myColor === "SPECTATOR") return;

    if (!skipConfirmation) {
        const actionWord = actionType === "RESIGN" ? "Resign" : "Abort";
        const message = actionType === "RESIGN"
            ? "Are you sure you want to resign and concede the game?"
            : "Are you sure you want to abort this match?";
        const confirmed = await showConfirmModal(`${actionWord} Game?`, message);
        if (!confirmed) return;
    }

    await fetch(`${SERVER_URL}/action?action=${actionType}&color=${myColor}`);
}

function executeLiveMoveUpdate(data) {
    updateStatusUI(data.status);
    logAlgebraicNotation(data.pieceCode, data.startX, data.startY, data.endX, data.endY, data.status, data.promotion);

    // Clear the initial auto-abort timer the moment any move is played
    if (autoAbortTimer) {
        clearTimeout(autoAbortTimer);
        autoAbortTimer = null;
    }

    // Update clocks and the authoritative turn color from server data
    if (data.whiteTime !== undefined && data.blackTime !== undefined) {
        serverWhiteTimeMs = data.whiteTime;
        serverBlackTimeMs = data.blackTime;
        localTimerStartMs = Date.now();

        // Update whose turn it is from the authoritative server field
        if (data.currentTurn) {
            currentTurnColor = data.currentTurn;
        }

        updateClockUI();

        const statusUpper = data.status ? data.status.toUpperCase() : "";
        const gameIsDead = isGameOverStatus(statusUpper);

        if (!gameIsDead) {
            startTimers();
        } else {
            clearInterval(timerInterval);
        }
    }

    // Determine if the previous board had a piece on the destination (capture)
    const previousGrid = boardHistory[currentViewIndex];
    const isCapture = previousGrid && previousGrid[data.endX] && previousGrid[data.endX][data.endY] !== "";

    lastPlayedMove = { startX: data.startX, startY: data.startY, endX: data.endX, endY: data.endY };
    boardHistory.push(data.grid);
    currentViewIndex = boardHistory.length - 1;

    // ==========================================
    // BOARD UPDATE: Always redraw from authoritative server grid.
    // The optimistic update in attemptMove() only runs on the mover's client.
    // Opponents and spectators need the full redraw to see the piece move.
    // ==========================================
    drawBoard(data.grid);
    highlightLastMoveSquares();
    updateMaterial(data.grid);

    const statusUpper = data.status.toUpperCase();
    const isGameOver = isGameOverStatus(statusUpper);

    // After White's first move, start 10s countdown for Black to respond
    // boardHistory now has: [INITIAL, afterWhite1] → length === 2
    if (boardHistory.length === 2) {
        autoAbortTimer = setTimeout(() => {
            if (boardHistory.length === 2 && myColor === "WHITE") {
                sendAction("ABORT", true);
            }
        }, 10000);
    }

    // Audio feedback
    if (statusUpper.includes("CHECKMATE")) {
        sfxWin.play().catch(e => console.log("Audio blocked"));
    } else if (!isGameOver) {
        if (statusUpper.includes("CHECK")) {
            sfxCheck.play().catch(e => console.log("Audio blocked"));
        } else if (isCapture) {
            sfxCapture.play().catch(e => console.log("Audio blocked"));
        } else if (data.pieceCode && data.pieceCode.trim() !== "") {
            sfxMove.play().catch(e => console.log("Audio blocked"));
        }
    }

    const matchControls = document.getElementById("match-controls");
    const abortBtn = document.getElementById("btn-abort");

    if (isGameOver) {
        matchStarted = false;
        clearInterval(timerInterval);
        if (matchControls) matchControls.classList.add("hidden");

        if (!isGameOverLock) {
            sfxEnd.play().catch(e => console.log("Audio play blocked:", e));
            isGameOverLock = true;
        }

        displayOverlay(buildGameOverHTML(data.status), true);
        return;
    } else {
        if (matchControls && myColor !== "SPECTATOR") matchControls.classList.remove("hidden");

        if (abortBtn) {
            if (moveCounter <= 2) abortBtn.classList.remove("hidden");
            else abortBtn.classList.add("hidden");
        }

        // Always check/update king check highlight (function clears stale highlights internally)
        highlightKingInCheck();
    }
}

function executeLocalReset() {
    isGameOverLock = false;
    document.getElementById("match-controls").classList.add("hidden");
    clearInterval(timerInterval);
    if (autoAbortTimer) { clearTimeout(autoAbortTimer); autoAbortTimer = null; }

    // Reset all game state
    updateStatusUI("White's Turn");
    currentTurnColor = "WHITE";
    document.getElementById("move-log").innerHTML = "";
    moveCounter = 1;
    selectedSquare = null;
    boardHistory = [];
    currentViewIndex = -1;
    matchStarted = false;
    lastPlayedMove = null;

    serverWhiteTimeMs = 600000;
    serverBlackTimeMs = 600000;
    localTimerStartMs = Date.now();

    // Clear analysis arrows
    clearArrows();

    updateClockUI();
    fetchBoard();

    if (myColor !== "SPECTATOR") {
        displayOverlay(`<h2>New Game</h2><br><button onclick="declareReady()" style="padding:10px 20px; font-size:18px; cursor:pointer;">I am Ready</button>`);
    } else {
        updateStatusUI("Waiting for players to start new match...");
    }
}

async function leaveTable() {
    localStorage.removeItem("chessToken");
    if (myColor === "WHITE" || myColor === "BLACK") {
        await fetch(`${SERVER_URL}/leave`);
    }
    window.location.reload();
}

async function resetGame() { await fetch(`${SERVER_URL}/reset`); }

// ==========================================
// 4. ACTION FUNCTIONS
// ==========================================
async function attemptMove(startX, startY, endX, endY, pieceCode) {
    if (!matchStarted) return;

    clearValidMoves();

    // Optimistically move the piece in the DOM using appendChild to keep event listeners.
    // If the server rejects the move, the ERROR block below will redraw the board from history.
    const startSquareDiv = document.getElementById(`square-${startX}-${startY}`);
    const endSquareDiv = document.getElementById(`square-${endX}-${endY}`);
    const pieceImg = startSquareDiv ? startSquareDiv.querySelector('.piece-symbol') : null;
    
    if (pieceImg && endSquareDiv) {
        const existingPiece = endSquareDiv.querySelector('.piece-symbol');
        if (existingPiece) {
            existingPiece.remove(); // Optimistically remove captured piece
        }
        endSquareDiv.appendChild(pieceImg);
    }
    let promotionCode = "";
    if ((pieceCode === "wP" && startX === 6 && endX === 7) || (pieceCode === "bP" && startX === 1 && endX === 0)) {
        promotionCode = await triggerPromotionUI(pieceCode[0]);
    }

    let url = `${SERVER_URL}/move?startX=${startX}&startY=${startY}&endX=${endX}&endY=${endY}&pieceCode=${pieceCode}`;
    if (promotionCode) url += `&promotion=${promotionCode}`;

    const response = await fetch(url);
    const statusText = await response.text();

    if (statusText.includes("ERROR")) {
        // Capture the start square element BEFORE redraw to ensure correct highlight target
        const startSquareDiv = document.getElementById(`square-${startX}-${startY}`);

        // Full authoritative redraw from last valid server state
        drawBoard(boardHistory[currentViewIndex]);
        highlightLastMoveSquares();
        document.getElementById("status").innerText = statusText;

        // Apply invalid-move highlight to the captured start square element
        if (startSquareDiv) {
            startSquareDiv.classList.add("invalid-move");
            setTimeout(() => startSquareDiv.classList.remove("invalid-move"), 800);
        }
        return;
    }
    // On success: the WebSocket broadcast triggers executeLiveMoveUpdate() which redraws.
}

// ==========================================
// 5. RENDERING & UI LOGIC
// ==========================================
async function fetchBoard() {
    try {
        const response = await fetch(`${SERVER_URL}/sync?t=${new Date().getTime()}`);
        const data = await response.json();

        // Sync clocks and authoritative turn color
        if (data.whiteTime !== undefined && data.blackTime !== undefined) {
            serverWhiteTimeMs = data.whiteTime;
            serverBlackTimeMs = data.blackTime;
            localTimerStartMs = Date.now();

            if (data.currentTurn) {
                currentTurnColor = data.currentTurn;
            }

            updateClockUI();
        }

        // Rebuild move log and board history from server memory
        document.getElementById("move-log").innerHTML = "";
        moveCounter = 1;

        // Only trust moveHistory if the server says a match is currently active.
        // If matchStarted is false, the moveHistory may contain stale data from a previous game
        // (since backend resetGame() now clears it, but this is a defensive check).
        const isMatchActive = data.matchStarted === true;
        boardHistory = [INITIAL_BOARD];

        if (isMatchActive && data.moveHistory && data.moveHistory.length > 0) {
            const lastMove = data.moveHistory[data.moveHistory.length - 1];
            lastPlayedMove = { startX: lastMove.startX, startY: lastMove.startY, endX: lastMove.endX, endY: lastMove.endY };

            data.moveHistory.forEach(move => {
                logAlgebraicNotation(move.pieceCode, move.startX, move.startY, move.endX, move.endY, move.status, move.promotion);
                boardHistory.push(move.grid);
                lastKnownStatus = move.status;
            });
        } else {
            lastPlayedMove = null;
            lastKnownStatus = "White's Turn";
        }

        // Ensure the last slot reflects the true current board
        boardHistory[boardHistory.length - 1] = data.grid;
        currentViewIndex = boardHistory.length - 1;

        updateStatusUI(lastKnownStatus);
        drawBoard(data.grid);
        highlightLastMoveSquares();
        highlightKingInCheck();
        updateMaterial(data.grid);

        const statusUpper = lastKnownStatus.toUpperCase();
        const isGameOver = isGameOverStatus(statusUpper);

        if (isGameOver) {
            matchStarted = false;
            clearInterval(timerInterval);
            const matchControls = document.getElementById("match-controls");
            if (matchControls) matchControls.classList.add("hidden");

            if (!isGameOverLock) {
                sfxEnd.play().catch(e => console.log("Audio play blocked:", e));
                isGameOverLock = true;
            }

            displayOverlay(buildGameOverHTML(lastKnownStatus), true);

        } else {
            clearInterval(timerInterval);

            if (data.matchStarted) {
                matchStarted = data.matchStarted;
                startTimers();
            }

            if (myColor !== "SPECTATOR") {
                matchStarted = data.matchStarted;
                if (matchStarted) hideOverlay();

                const matchControls = document.getElementById("match-controls");
                const abortBtn = document.getElementById("btn-abort");

                if (matchControls) matchControls.classList.remove("hidden");

                if (abortBtn) {
                    if (moveCounter <= 2) abortBtn.classList.remove("hidden");
                    else abortBtn.classList.add("hidden");
                }
            }

            // Always check/update king check highlight (function clears stale highlights internally)
            highlightKingInCheck();
        }
    } catch (error) {
        console.log("Fetch error:", error);
    }
}

// ==========================================
// SHARED HELPERS
// ==========================================

// Returns true for any status string that indicates the game is definitively over
function isGameOverStatus(upperStatus) {
    return upperStatus.includes("MATE")     ||
           upperStatus.includes("DRAW")     ||
           upperStatus.includes("RESIGN")   ||
           upperStatus.includes("ABORT")    ||
           upperStatus.includes("TIME")     ||
           upperStatus.includes("ABANDONED");
}

// Builds the game-over overlay HTML from a raw status string
function buildGameOverHTML(rawStatus) {
    const statusUpper = rawStatus.toUpperCase();
    let overlayTitle = "Game Over";
    let cleanMessage = rawStatus;

    if (statusUpper.includes("CHECKMATE"))  overlayTitle = "CHECKMATE";
    else if (statusUpper.includes("TIME"))  overlayTitle = "TIME OUT";
    else if (statusUpper.includes("ABORT")) overlayTitle = "MATCH ABORTED";
    else if (statusUpper.includes("DRAW"))  overlayTitle = "DRAW";
    else if (statusUpper.includes("RESIGN")) overlayTitle = "RESIGNATION";
    else if (statusUpper.includes("ABANDONED")) {
        const leaver = statusUpper.includes("WHITE ABANDONED") ? "White" : "Black";
        overlayTitle = `${leaver} Abandoned!`;
    }

    // Strip known prefixes so we don't show redundant text
    cleanMessage = cleanMessage
        .replace(/RESIGNATION!?/ig, "")
        .replace(/CHECKMATE!?/ig, "")
        .replace(/TIME_OUT!?/ig, "")
        .replace(/TIME OUT!?/ig, "")
        .replace(/TIMEOUT!?/ig, "")
        .replace(/MATCH ABORTED!?/ig, "")
        .replace(/ABORTED!?/ig, "");

    if (statusUpper.includes("ABANDONED")) {
        const winner = statusUpper.includes("WHITE ABANDONED") ? "Black" : "White";
        cleanMessage = `${winner} wins!`;
    } else {
        cleanMessage = cleanMessage.trim();
    }

    return cleanMessage === "" ? overlayTitle : `${overlayTitle}<br>${cleanMessage}`;
}

// THEME SWITCHER
const themes = {
    wood:     { light: "#f0d9b5", dark: "#b58863", highlight: "rgba(255, 170, 0, 0.45)" },
    ocean:    { light: "#dee3e6", dark: "#8ca2ad", highlight: "rgba(52, 152, 219, 0.5)" },
    midnight: { light: "#cdc9d8", dark: "#695b8e", highlight: "rgba(155, 199, 0, 0.5)" }
};

function changeTheme(themeName) {
    if (!themeName) themeName = "wood";
    const theme = themes[themeName];
    if (!theme) return;

    document.documentElement.style.setProperty('--light-square', theme.light);
    document.documentElement.style.setProperty('--dark-square', theme.dark);
    document.documentElement.style.setProperty('--highlight-color', theme.highlight);

    localStorage.setItem("chessTheme", themeName);
    document.querySelectorAll('.swatch').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.swatch.${themeName}`);
    if (activeBtn) activeBtn.classList.add('active');
}
changeTheme(localStorage.getItem("chessTheme") || "wood");

function highlightLastMoveSquares() {
    // Clear all previous highlights first
    document.querySelectorAll('.last-move-highlight').forEach(el => el.classList.remove('last-move-highlight'));

    if (currentViewIndex === boardHistory.length - 1 && lastPlayedMove) {
        const startSquare = document.getElementById(`square-${lastPlayedMove.startX}-${lastPlayedMove.startY}`);
        const endSquare   = document.getElementById(`square-${lastPlayedMove.endX}-${lastPlayedMove.endY}`);

        if (startSquare) startSquare.classList.add('last-move-highlight');
        if (endSquare) {
            endSquare.classList.add('last-move-highlight');
            const movedPiece = endSquare.querySelector('.piece-symbol');
            if (movedPiece) movedPiece.classList.add('animate-drop');
        }
    }
}

function drawBoard(grid) {
    const boardDiv = document.getElementById("chessboard");
    
    // Check if squares already exist (first run vs update)
    // Use querySelectorAll to count only .square elements, not the arrow overlay SVG
    const squaresExist = boardDiv.querySelectorAll(".square").length === 64;
    
    // Create SVG overlay for arrows on first run
    if (!squaresExist) {
        createArrowOverlay(boardDiv);
    }

    let rows = [7, 6, 5, 4, 3, 2, 1, 0];
    let cols = [0, 1, 2, 3, 4, 5, 6, 7];
    const fileNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    if (myColor === "BLACK") {
        rows = [...rows].reverse();
        cols = [...cols].reverse();
    }

    // Iterate in VISUAL order (rows/cols arrays) for correct CSS grid positioning
    // rows/cols arrays already contain LOGICAL coordinates in correct visual order
    for (const row of rows) {
        for (const col of cols) {
            // row and col are already the correct logical coordinates
            // No conversion needed - arrays are perspective-correct
            
            const squareId = `square-${row}-${col}`;
            let square = document.getElementById(squareId);
            const pieceCode = grid[row][col];

            if (!square) {
                // First run: create square from scratch
                square = document.createElement("div");
                square.className = `square ${(row + col) % 2 === 0 ? 'dark' : 'light'}`;
                square.id = squareId;
                square.style.position = "relative";

                // Coordinate labels (at visual edges for current perspective)
                // Bottom rank = last row in visual iteration (rows[7])
                // Left file = first col in visual iteration (cols[0])
                const isBottomRank = row === rows[7];
                const isLeftFile = col === cols[0];
                if (isBottomRank) {
                    const fileLabel = document.createElement("span");
                    fileLabel.className = "coord-file";
                    fileLabel.innerText = fileNames[col];
                    square.appendChild(fileLabel);
                }
                if (isLeftFile) {
                    const rankLabel = document.createElement("span");
                    rankLabel.className = "coord-rank";
                    rankLabel.innerText = row + 1;
                    square.appendChild(rankLabel);
                }

                if (pieceCode) {
                    const pieceImg = createPieceElement(pieceCode, row, col);
                    square.appendChild(pieceImg);
                }

                boardDiv.appendChild(square);
            } else {
                // Update: sync piece image
                const existingPieceImg = square.querySelector('.piece-symbol');
                if (pieceCode) {
                    if (existingPieceImg) {
                        if (existingPieceImg.src !== pieceImages[pieceCode]) {
                            existingPieceImg.src = pieceImages[pieceCode];
                        }
                        // Keep dataset.pieceCode in sync with the authoritative grid
                        existingPieceImg.dataset.pieceCode = pieceCode;
                        // Keep dataset.startX/Y in sync for drag-and-drop coordinates
                        existingPieceImg.dataset.startX = row;
                        existingPieceImg.dataset.startY = col;
                    } else {
                        const pieceImg = createPieceElement(pieceCode, row, col);
                        square.appendChild(pieceImg);
                    }
                } else if (existingPieceImg) {
                    existingPieceImg.remove();
                }
            }

            // ALWAYS refresh event handlers with current logical coordinates
            // This fixes stale pieceCode in closures and ensures correct mapping
            square.onclick = () => handleSquareClick(row, col, square);
            
            // Replace drag handlers (using on... properties to avoid duplicates)
            square.ondragover  = (e) => e.preventDefault();
            square.ondragenter = (e) => e.currentTarget.classList.add("drag-over");
            square.ondragleave = (e) => e.currentTarget.classList.remove("drag-over");
            square.ondrop      = (e) => handleDrop(e, row, col);
        }
    }
}

// Helper to create piece element with all event listeners
function createPieceElement(pieceCode, row, col) {
    const pieceImg = document.createElement("img");
    pieceImg.className = "piece-symbol";
    pieceImg.src = pieceImages[pieceCode];
    pieceImg.draggable = true;
    pieceImg.dataset.pieceCode = pieceCode;
    pieceImg.dataset.startX = row;
    pieceImg.dataset.startY = col;

    pieceImg.addEventListener("dragstart", (e) => {
        if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
            e.preventDefault();
            return;
        }
        if (currentViewIndex < boardHistory.length - 1) { e.preventDefault(); return; }
        if (selectedSquare) { selectedSquare.div.classList.remove("selected"); selectedSquare = null; }
        // Read current position from element data attributes (updated on each move/redraw)
        const startX = parseInt(pieceImg.dataset.startX, 10);
        const startY = parseInt(pieceImg.dataset.startY, 10);
        e.dataTransfer.setData("text/plain", JSON.stringify({ startX, startY, piece: pieceCode }));
        setTimeout(() => pieceImg.classList.add("dragging"), 0);
        showValidMoves(startX, startY);
    });

    pieceImg.addEventListener("dragend", () => pieceImg.classList.remove("dragging"));
    return pieceImg;
}

function handleSquareClick(row, col, squareDiv) {
    // Disable clicks when reviewing history
    if (currentViewIndex < boardHistory.length - 1) return;

    // Read current piece from DOM (avoids stale closure values)
    const pieceImg = squareDiv.querySelector('.piece-symbol');
    const pieceCode = pieceImg ? pieceImg.dataset.pieceCode || "" : "";
    
    const myColorPrefix = myColor === "WHITE" ? 'w' : 'b';
    const isOwnPiece = pieceCode !== "" && pieceCode[0] === myColorPrefix;

    if (selectedSquare === null) {
        // No piece selected yet — select if it's our own piece
        if (isOwnPiece && myColor !== "SPECTATOR") {
            selectedSquare = { x: row, y: col, div: squareDiv, piece: pieceCode };
            squareDiv.classList.add("selected");
            showValidMoves(row, col);
        }
    } else {
        const startX = selectedSquare.x;
        const startY = selectedSquare.y;
        const movingPiece = selectedSquare.piece;

        // If clicking another own piece: re-select instead of attempting an illegal move
        if (isOwnPiece && myColor !== "SPECTATOR" && !(startX === row && startY === col)) {
            selectedSquare.div.classList.remove("selected");
            clearValidMoves();
            selectedSquare = { x: row, y: col, div: squareDiv, piece: pieceCode };
            squareDiv.classList.add("selected");
            showValidMoves(row, col);
            return;
        }

        // Clicking the same square: deselect
        if (startX === row && startY === col) {
            selectedSquare.div.classList.remove("selected");
            selectedSquare = null;
            clearValidMoves();
            return;
        }

        // Otherwise: attempt the move
        selectedSquare.div.classList.remove("selected");
        selectedSquare = null;
        clearValidMoves();
        attemptMove(startX, startY, row, col, movingPiece);
    }
}

function handleDrop(e, endX, endY) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    if (currentViewIndex < boardHistory.length - 1) return;
    const dragData = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (dragData.startX === endX && dragData.startY === endY) return;
    attemptMove(dragData.startX, dragData.startY, endX, endY, dragData.piece);
}

// ==========================================
// ANALYSIS ARROWS (Right-click drag)
// ==========================================
let arrowSvg = null;
let arrowLayer = null;
let isDrawingArrow = false;
let arrowStartSquare = null;
let currentArrow = null;

function createArrowOverlay(boardDiv) {
    arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrowSvg.id = "arrow-overlay";
    arrowSvg.setAttribute("viewBox", "0 0 100 100");
    arrowSvg.style.position = "absolute";
    arrowSvg.style.top = "0";
    arrowSvg.style.left = "0";
    arrowSvg.style.width = "100%";
    arrowSvg.style.height = "100%";
    arrowSvg.style.pointerEvents = "none";
    arrowSvg.style.zIndex = "10";
    
    arrowLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    arrowLayer.id = "arrow-layer";
    arrowSvg.appendChild(arrowLayer);
    
    boardDiv.appendChild(arrowSvg);
    
    boardDiv.addEventListener("contextmenu", (e) => e.preventDefault());
    boardDiv.addEventListener("mousedown", handleArrowMouseDown);
    document.addEventListener("mousemove", handleArrowMouseMove);
    document.addEventListener("mouseup", handleArrowMouseUp);
    boardDiv.addEventListener("click", clearArrows);
}

function getSquareFromEvent(e) {
    const square = e.target.closest(".square");
    if (!square) return null;
    const id = square.id;
    const parts = id.split("-");
    return { row: parseInt(parts[1]), col: parseInt(parts[2]), element: square };
}

function getSquareCenter(row, col) {
    const isFlipped = myColor === "BLACK";
    // Account for both vertical and horizontal flip when playing as Black
    const visualRow = isFlipped ? row : 7 - row;
    const visualCol = isFlipped ? 7 - col : col;
    const x = (visualCol + 0.5) * 12.5;
    const y = (visualRow + 0.5) * 12.5;
    return { x, y };
}

function createArrowPath(startRow, startCol, endRow, endCol) {
    const start = getSquareCenter(startRow, startCol);
    const end = getSquareCenter(endRow, endCol);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);
    const headSize = 1.0;
    const headAngle = Math.PI / 6;
    const headX1 = end.x - headSize * Math.cos(angle - headAngle);
    const headY1 = end.y - headSize * Math.sin(angle - headAngle);
    const headX2 = end.x - headSize * Math.cos(angle + headAngle);
    const headY2 = end.y - headSize * Math.sin(angle + headAngle);
    // viewBox is 0-100, so coordinates are unitless (not percentages)
    const pathData = `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${headX1} ${headY1} L ${end.x} ${end.y} L ${headX2} ${headY2}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("stroke", "#ff6b00");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.style.filter = "drop-shadow(0 0 2px rgba(0,0,0,0.5))";
    return path;
}

function handleArrowMouseDown(e) {
    if (e.button !== 2) return;
    // Disable arrow drawing when reviewing history
    if (currentViewIndex < boardHistory.length - 1) return;
    const square = getSquareFromEvent(e);
    if (!square) return;
    if (square.element.querySelector(".piece-symbol") && matchStarted && currentViewIndex === boardHistory.length - 1) {
        e.preventDefault();
    }
    isDrawingArrow = true;
    arrowStartSquare = { row: square.row, col: square.col };
    currentArrow = createArrowPath(square.row, square.col, square.row, square.col);
    currentArrow.setAttribute("stroke-dasharray", "4% 2%");
    currentArrow.setAttribute("opacity", "0.7");
    arrowLayer.appendChild(currentArrow);
}

function handleArrowMouseMove(e) {
    if (!isDrawingArrow || !arrowStartSquare) return;
    const square = getSquareFromEvent(e);
    if (!square) return;
    if (currentArrow) {
        const newArrow = createArrowPath(arrowStartSquare.row, arrowStartSquare.col, square.row, square.col);
        newArrow.setAttribute("stroke-dasharray", "4% 2%");
        newArrow.setAttribute("opacity", "0.7");
        arrowLayer.replaceChild(newArrow, currentArrow);
        currentArrow = newArrow;
    }
}

function handleArrowMouseUp(e) {
    if (!isDrawingArrow || !arrowStartSquare) return;
    if (e.button !== 2) { cancelArrow(); return; }
    const square = getSquareFromEvent(e);
    if (!square) { cancelArrow(); return; }
    if (square.row === arrowStartSquare.row && square.col === arrowStartSquare.col) { cancelArrow(); return; }
    if (currentArrow) {
        const finalArrow = createArrowPath(arrowStartSquare.row, arrowStartSquare.col, square.row, square.col);
        finalArrow.setAttribute("opacity", "1");
        arrowLayer.replaceChild(finalArrow, currentArrow);
        currentArrow = null;
    }
    isDrawingArrow = false;
    arrowStartSquare = null;
}

function cancelArrow() {
    if (currentArrow) { currentArrow.remove(); currentArrow = null; }
    isDrawingArrow = false;
    arrowStartSquare = null;
}

function clearArrows() {
    if (arrowLayer) { arrowLayer.innerHTML = ""; }
}

window.clearArrows = clearArrows;

function updateMaterial(grid) {
    let whitePoints = 0, blackPoints = 0;
    let whiteCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 };
    let blackCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 };

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = grid[r][c];
            if (p && p[1] !== 'K') {
                if (p[0] === 'w') { whitePoints += pieceValues[p[1]]; whiteCounts[p[1]]++; }
                else              { blackPoints += pieceValues[p[1]]; blackCounts[p[1]]++; }
            }
        }
    }

    let capturedByBlack = [], capturedByWhite = [];
    for (const type in startingCounts) {
        let missingWhite = Math.max(0, startingCounts[type] - whiteCounts[type]);
        for (let i = 0; i < missingWhite; i++) capturedByBlack.push('w' + type);
        let missingBlack = Math.max(0, startingCounts[type] - blackCounts[type]);
        for (let i = 0; i < missingBlack; i++) capturedByWhite.push('b' + type);
    }

    const diff = whitePoints - blackPoints;
    const whiteAdvantage = diff > 0 ? `+${diff}` : "";
    const blackAdvantage = diff < 0 ? `+${Math.abs(diff)}` : "";

    renderCapturedPieces("captured-by-black", capturedByBlack, blackAdvantage);
    renderCapturedPieces("captured-by-white", capturedByWhite, whiteAdvantage);
}

function renderCapturedPieces(containerId, pieces, advantage) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    if (pieces.length === 0 && !advantage) {
        container.style.display = "none";
        return;
    } else {
        container.style.display = "flex";
    }

    const sortOrder = { 'Q': 1, 'R': 2, 'B': 3, 'N': 4, 'P': 5 };
    pieces.sort((a, b) => sortOrder[a[1]] - sortOrder[b[1]]);

    pieces.forEach(p => {
        const img = document.createElement("img");
        img.src = pieceImages[p];
        img.className = 'captured-piece ' + (p[0] === 'w' ? 'captured-white' : 'captured-black');
        container.appendChild(img);
    });

    if (advantage) {
        const advSpan = document.createElement("span");
        advSpan.className = "advantage-score";
        advSpan.innerText = advantage;
        container.appendChild(advSpan);
    }
}

function updateTimelineUI() {
    const boardDiv  = document.getElementById("chessboard");
    const statusDiv = document.getElementById("status");

    if (currentViewIndex < boardHistory.length - 1) {
        boardDiv.classList.add("review-mode");
        statusDiv.innerText = `REVIEW MODE: Viewing Move ${currentViewIndex}`;
        hideOverlay();
    } else {
        boardDiv.classList.remove("review-mode");
        statusDiv.innerText = lastKnownStatus;
    }

    drawBoard(boardHistory[currentViewIndex]);
    highlightLastMoveSquares();
    // Only highlight king in check on the live position, not historical frames
    if (currentViewIndex === boardHistory.length - 1) {
        highlightKingInCheck();
    }
    updateMaterial(boardHistory[currentViewIndex]);
}

function viewPrevious() { if (currentViewIndex > 0) { currentViewIndex--; updateTimelineUI(); } }
function viewNext()     { if (currentViewIndex < boardHistory.length - 1) { currentViewIndex++; updateTimelineUI(); } }
function viewFirst()    { if (currentViewIndex !== 0) { currentViewIndex = 0; updateTimelineUI(); } }

function viewLive() {
    if (currentViewIndex !== boardHistory.length - 1) {
        currentViewIndex = boardHistory.length - 1;
        updateTimelineUI();
    }

    // Restore the game-over overlay for ALL terminal states
    const statusUpper = lastKnownStatus.toUpperCase();
    if (isGameOverStatus(statusUpper)) {
        displayOverlay(buildGameOverHTML(lastKnownStatus), true);
    }
}

function triggerPromotionUI(colorChar) {
    return new Promise((resolve) => {
        const modal = document.getElementById("promotion-modal");
        const optionsDiv = document.getElementById("promotion-options");
        optionsDiv.innerHTML = "";

        ["Q", "R", "B", "N"].forEach(type => {
            const pieceCode = colorChar + type;
            const btn = document.createElement("img");
            btn.className = "promo-choice";
            btn.src = pieceImages[pieceCode];
            btn.onclick = () => { modal.classList.add("hidden"); resolve(type); };
            optionsDiv.appendChild(btn);
        });

        modal.classList.remove("hidden");
    });
}

async function showValidMoves(startX, startY) {
    clearValidMoves();
    const response = await fetch(`${SERVER_URL}/validMoves?startX=${startX}&startY=${startY}&t=${new Date().getTime()}`);
    const validCoordinates = await response.json();
    validCoordinates.forEach(coord => {
        const square = document.getElementById(`square-${coord[0]}-${coord[1]}`);
        if (square) {
            const hintDot = document.createElement("div");
            hintDot.className = "valid-move-hint";
            square.appendChild(hintDot);
        }
    });
}

function clearValidMoves() {
    document.querySelectorAll(".valid-move-hint").forEach(dot => dot.remove());
}

function logAlgebraicNotation(pieceCode, startX, startY, endX, endY, statusText, promotionCode) {
    if (!pieceCode) return;
    const startSquare = `${String.fromCharCode(97 + startY)}${startX + 1}`;
    const endSquare   = `${String.fromCharCode(97 + endY)}${endX + 1}`;
    let notation = `${moveCounter}. ${pieceMap[pieceCode]} ${startSquare} → ${endSquare}`;
    if (promotionCode) notation += `=${pieceMap[pieceCode[0] + promotionCode]}`;
    if (statusText.includes("CHECKMATE"))     notation += " #";
    else if (statusText.includes("CHECK"))    notation += " +";
    else if (statusText.includes("DRAW"))     notation += " ½-½";

    const logDiv = document.getElementById("move-log");
    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.innerText = notation;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    moveCounter++;
}

function highlightKingInCheck() {
    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));

    const upperText = lastKnownStatus.toUpperCase();
    if (!upperText.includes("CHECK")) return;

    // In CHECKMATE, the losing king is highlighted. In CHECK, the king under attack.
    let targetKing;
    if (upperText.includes("CHECKMATE")) {
        // "CHECKMATE! WHITE wins!" → black king is in checkmate
        // "CHECKMATE! BLACK wins!" → white king is in checkmate
        targetKing = upperText.includes("WHITE WINS") ? "bK" : "wK";
    } else {
        // "CHECK! WHITE's King is under attack!" → white king
        // "CHECK! BLACK's King is under attack!" → black king
        targetKing = upperText.includes("WHITE") ? "wK" : "bK";
    }

    const currentGrid = boardHistory[currentViewIndex];
    if (!currentGrid) return;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (currentGrid[r][c] === targetKing) {
                const sq = document.getElementById(`square-${r}-${c}`);
                if (sq) sq.classList.add("check-square");
                return;
            }
        }
    }
}

function displayOverlay(message, showReset = false) {
    let finalHtml = message;
    if (showReset && myColor !== "SPECTATOR") {
        finalHtml += `
        <br><br>
        <div style="display: flex; gap: 15px; justify-content: center;">
            <button onclick="resetGame()" style="padding:10px 20px; font-size:18px; cursor:pointer; background-color:#34495e; color:white; border:none; border-radius:5px;">Rematch</button>
            <button onclick="leaveTable()" style="padding:10px 20px; font-size:18px; cursor:pointer; background-color:#c0392b; color:white; border:none; border-radius:5px;">Leave Table</button>
        </div>`;
    }
    document.getElementById("overlay-message").innerHTML = finalHtml;
    document.getElementById("overlay").classList.remove("hidden");
}

function hideOverlay() {
    document.getElementById("overlay").classList.add("hidden");
}

// ==========================================
// 6. TIMERS & CLOCK LOGIC
// ==========================================
function startTimers() {
    clearInterval(timerInterval);

    // Don't start ticking if the game is definitively over
    const statusUpper = lastKnownStatus.toUpperCase();
    if (isGameOverStatus(statusUpper)) return;

    timerInterval = setInterval(() => {
        const elapsedLocalMs = Date.now() - localTimerStartMs;
        let displayWhiteMs = serverWhiteTimeMs;
        let displayBlackMs = serverBlackTimeMs;

        // Use the authoritative currentTurnColor — never parse status strings for this
        if (currentTurnColor === "WHITE") {
            displayWhiteMs = serverWhiteTimeMs - elapsedLocalMs;
        } else {
            displayBlackMs = serverBlackTimeMs - elapsedLocalMs;
        }

        updateClockUI(displayWhiteMs, displayBlackMs);

        // Trigger server-side timeout check when a clock hits zero
        if (displayWhiteMs <= 0 || displayBlackMs <= 0) {
            clearInterval(timerInterval);
            fetch(`${SERVER_URL}/timeout`);
        }
    }, 200);
}

function updateClockUI(wMs = serverWhiteTimeMs, bMs = serverBlackTimeMs) {
    const formatTime = (totalMs) => {
        if (totalMs <= 0) return "00:00";
        const totalSeconds = Math.floor(totalMs / 1000);
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const wClock = document.getElementById("white-clock");
    const bClock = document.getElementById("black-clock");
    wClock.innerText = formatTime(wMs);
    bClock.innerText = formatTime(bMs);
    wMs < 30000 ? wClock.classList.add("time-low") : wClock.classList.remove("time-low");
    bMs < 30000 ? bClock.classList.add("time-low") : bClock.classList.remove("time-low");
}

// ==========================================
// 7. START THE APP
// ==========================================
(async function init() {
    await joinGame();
    connectWebSocket();
    fetchBoard();
})();

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchBoard();
});

// ==========================================
// CHAT & EMOJI LOGIC
// ==========================================
const chatInput    = document.getElementById("chat-input");
const chatSendBtn  = document.getElementById("chat-send");
const chatMessages = document.getElementById("chat-messages");
const emojiToggle  = document.getElementById("emoji-toggle");
const emojiPicker  = document.getElementById("emoji-picker");

let unreadChatCount = 0;

function toggleChat() {
    const container = document.getElementById("chat-container");
    const isCollapsed = container.classList.toggle("collapsed");

    // Persist preference
    localStorage.setItem("chatCollapsed", isCollapsed ? "1" : "0");

    if (!isCollapsed) {
        // Opened — clear unread badge and scroll to latest message
        unreadChatCount = 0;
        const badge = document.getElementById("chat-unread");
        if (badge) { badge.textContent = ""; badge.classList.remove("visible"); }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Restore collapse state from previous session (default: collapsed)
(function initChatState() {
    const pref = localStorage.getItem("chatCollapsed");
    const container = document.getElementById("chat-container");
    // Default collapsed unless user explicitly opened it last time
    if (pref === "0") {
        container.classList.remove("collapsed");
    } else {
        container.classList.add("collapsed");
    }
})();

if (emojiToggle) {
    emojiToggle.addEventListener("click", () => emojiPicker.classList.toggle("hidden"));
}

document.querySelectorAll(".emoji").forEach(el => {
    el.addEventListener("click", (e) => {
        chatInput.value += e.target.innerText;
        emojiPicker.classList.add("hidden");
        chatInput.focus();
    });
});

function sendChatMessage() {
    const text = chatInput.value.trim();
    // Spectators cannot chat. Players can chat any time (lobby, game, post-game).
    if (text === "" || myColor === "SPECTATOR") return;
    if (!stompClient || !stompClient.connected) return;

    const payload = {
        sender: myColor,
        message: text
    };

    stompClient.send("/app/chat", {}, JSON.stringify(payload));
    chatInput.value = "";
    emojiPicker.classList.add("hidden");
}

if (chatSendBtn) chatSendBtn.addEventListener("click", sendChatMessage);
if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendChatMessage();
    });
}

// ==========================================
// UI THEME TOGGLE (Light/Dark Mode)
// ==========================================
let currentTheme = "dark"; // Global theme state

function initUITheme() {
    const root = document.documentElement;
    const toggleBtn = document.getElementById("theme-toggle");

    // Determine initial theme: localStorage > prefers-color-scheme > light (default)
    let savedTheme = localStorage.getItem("uiTheme");
    if (!savedTheme) {
        // Default to light theme
        savedTheme = "light";
    }
    root.dataset.theme = savedTheme;
    currentTheme = savedTheme;

    if (toggleBtn) {
        toggleBtn.addEventListener("click", toggleUITheme);
    }

    // Listen for system preference changes (only if user hasn't explicitly chosen)
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        if (!localStorage.getItem("uiTheme")) {
            const newTheme = e.matches ? "dark" : "light";
            root.dataset.theme = newTheme;
            currentTheme = newTheme;
        }
    });
}

function toggleUITheme() {
    const root = document.documentElement;
    const newTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = newTheme;
    currentTheme = newTheme;
    localStorage.setItem("uiTheme", newTheme);
}

// Ensure global access for any inline handlers
window.toggleUITheme = toggleUITheme;

// Initialize theme early (before background grid starts)
initUITheme();

// ==========================================
// 13. DOTTED BACKGROUND GRID (Stitch-inspired)
// ==========================================
(function initBackgroundGrid() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.warn("Background grid: 2D context unavailable, skipping initialization");
        return;
    }
    let dots = [];
    let mouseX = -10000;
    let mouseY = -10000;
    let animationId = null;
    let currentTheme = "dark";

    // Theme-aware color getters
    function getThemeColors() {
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const dotColor = style.getPropertyValue("--dot-color").trim();
        const dotColorHover = style.getPropertyValue("--dot-color-hover").trim();
        
        // Parse rgba(r, g, b, a) or rgb(r, g, b)
        function parseColor(colorStr) {
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            return [100, 85, 160];
        }
        return {
            base: parseColor(dotColor),
            hover: parseColor(dotColorHover)
        };
    }

    let colors = getThemeColors();
    const DOT_SPACING = 28;
    const DOT_BASE_RADIUS = 1.2;
    const DOT_MAX_RADIUS = 2.8;
    const GLOW_RADIUS = 100;
    const BASE_OPACITY = 0.15;
    const HOVER_OPACITY = 0.45;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        colors = getThemeColors();
        generateDots();
    }

    function generateDots() {
        dots = [];
        const cols = Math.ceil(canvas.width / DOT_SPACING) + 1;
        const rows = Math.ceil(canvas.height / DOT_SPACING) + 1;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                dots.push({
                    x: x * DOT_SPACING + (Math.random() - 0.5) * 4,
                    y: y * DOT_SPACING + (Math.random() - 0.5) * 4,
                    baseRadius: DOT_BASE_RADIUS,
                    currentRadius: DOT_BASE_RADIUS,
                    targetRadius: DOT_BASE_RADIUS,
                    opacity: BASE_OPACITY,
                    targetOpacity: BASE_OPACITY
                });
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const dot of dots) {
            const dx = dot.x - mouseX;
            const dy = dot.y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < GLOW_RADIUS) {
                const factor = 1 - dist / GLOW_RADIUS;
                dot.targetRadius = DOT_BASE_RADIUS + factor * (DOT_MAX_RADIUS - DOT_BASE_RADIUS);
                dot.targetOpacity = BASE_OPACITY + factor * (HOVER_OPACITY - BASE_OPACITY);
            } else {
                dot.targetRadius = DOT_BASE_RADIUS;
                dot.targetOpacity = BASE_OPACITY;
            }

            // Smooth interpolation
            dot.currentRadius += (dot.targetRadius - dot.currentRadius) * 0.15;
            dot.opacity += (dot.targetOpacity - dot.opacity) * 0.15;

            // Draw dot - always visible, enhanced near cursor
            const radius = dot.currentRadius;
            if (radius > 0.3) {
                const isHovered = dist < GLOW_RADIUS;
                const r = isHovered ? colors.hover[0] : colors.base[0];
                const g = isHovered ? colors.hover[1] : colors.base[1];
                const b = isHovered ? colors.hover[2] : colors.base[2];
                
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dot.opacity})`;
                ctx.fill();
            }
        }

        animationId = requestAnimationFrame(animate);
    }

    window.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    window.addEventListener("resize", resize);
    window.addEventListener("mouseleave", () => {
        mouseX = -10000;
        mouseY = -10000;
    });

    // Handle visibility change to pause/resume
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            cancelAnimationFrame(animationId);
        } else {
            animate();
        }
    });

    // Watch for theme changes
    const observer = new MutationObserver(() => {
        if (document.documentElement.dataset.theme !== currentTheme) {
            currentTheme = document.documentElement.dataset.theme || "dark";
            colors = getThemeColors();
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    resize();
    animate();
})();