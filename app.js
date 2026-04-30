// ==========================================
// 1. CONFIGURATION & VARIABLES
// ==========================================
const sfxMove = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-self.mp3');
const sfxCapture = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/capture.mp3');
const sfxEnd = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/notify.mp3');
const sfxCheck = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-check.mp3');
const sfxWin = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/game-end.mp3');

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PROD_BACKEND_URL = "https://dichess.onrender.com"; 
const SERVER_URL = isLocal ? "http://localhost:8080" : PROD_BACKEND_URL;

const pieceMap = { 
    "wK": "♚", "wQ": "♛", "wR": "♜", "wB": "♝", "wN": "♞", "wP": "♟", 
    "bK": "♚", "bQ": "♛", "bR": "♜", "bB": "♝", "bN": "♞", "bP": "♟", 
    "": "" 
};

// NEW: Professional high-res SVG pieces
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
    ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
    ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
    ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"]
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

let serverWhiteTimeMs = 600000; 
let serverBlackTimeMs = 600000;
let localTimerStartMs = Date.now(); 
let timerInterval = null;
let stompClient = null;

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
        // THE FIX: Immediately tell the server who we are so it can cancel any countdown timers!
        if (myColor !== "SPECTATOR") {
            stompClient.send("/app/register", {}, myColor);
        }

        stompClient.subscribe('/topic/game', function (message) {
            const data = JSON.parse(message.body);
            
            if (data.type === "RESET") executeLocalReset();
            else if (data.type === "START") startOfficialMatch(); 
            else if (data.type === "MOVE") executeLiveMoveUpdate(data);
            else if (data.type === "KICK") window.location.reload(); 
        });
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
function startOfficialMatch() {
    matchStarted = true;
    hideOverlay();
    
    if (myColor !== "SPECTATOR") {
        document.getElementById("match-controls").classList.remove("hidden");
        const abortBtn = document.getElementById("btn-abort");
        if (abortBtn) abortBtn.classList.remove("hidden");
    }
    
    localTimerStartMs = Date.now(); 
    startTimers(); 

    // Auto-abort if no moves are played
    autoAbortTimer = setTimeout(() => {
        if (moveCounter === 1) sendAction("ABORT", true); 
    }, 10000); 
}

// ==========================================
// NEW: CUSTOM PROMISE-BASED CONFIRMATION
// ==========================================
function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirm-modal");
        document.getElementById("confirm-title").innerText = title;
        document.getElementById("confirm-message").innerText = message;
        
        const btnYes = document.getElementById("btn-confirm-yes");
        const btnNo = document.getElementById("btn-confirm-no");

        // When a button is clicked, hide the modal and resolve the promise!
        btnYes.onclick = () => { modal.classList.add("hidden"); resolve(true); };
        btnNo.onclick = () => { modal.classList.add("hidden"); resolve(false); };

        modal.classList.remove("hidden");
    });
}

// Updated Action Function
async function sendAction(actionType, skipConfirmation = false) {
    if (myColor === "SPECTATOR") return;
    
    if (!skipConfirmation) {
        const actionWord = actionType === "RESIGN" ? "Resign" : "Abort";
        const message = actionType === "RESIGN" 
            ? "Are you sure you want to resign and concede the game?" 
            : "Are you sure you want to abort this match?";
            
        // THE FIX: Use our new custom UI instead of window.confirm!
        const confirmed = await showConfirmModal(`${actionWord} Game?`, message);
        
        // If they clicked "Cancel", stop right here
        if (!confirmed) return;
    }
    
    await fetch(`${SERVER_URL}/action?action=${actionType}&color=${myColor}`);
}

function executeLiveMoveUpdate(data) {
    updateStatusUI(data.status); 
    logAlgebraicNotation(data.pieceCode, data.startX, data.startY, data.endX, data.endY, data.status, data.promotion);

    if (autoAbortTimer) {
        clearTimeout(autoAbortTimer);
        autoAbortTimer = null;
    }

    if (moveCounter === 2) {
        autoAbortTimer = setTimeout(() => {
            if (moveCounter === 2) sendAction("ABORT", true);
        }, 10000);
    }

    if (data.whiteTime !== undefined && data.blackTime !== undefined) {
        serverWhiteTimeMs = data.whiteTime;
        serverBlackTimeMs = data.blackTime;
        localTimerStartMs = Date.now(); 
        updateClockUI(); 
        startTimers(); 
    }

    const previousGrid = boardHistory[currentViewIndex];
    const isCapture = previousGrid[data.endX][data.endY] !== "";

    lastPlayedMove = { startX: data.startX, startY: data.startY, endX: data.endX, endY: data.endY };
    boardHistory.push(data.grid);
    currentViewIndex = boardHistory.length - 1;

    drawBoard(data.grid);
    highlightLastMoveSquares(); 
    highlightKingInCheck();
    updateMaterial(data.grid);

    if (data.status.includes("CHECKMATE")) sfxWin.play().catch(e => console.log("Audio blocked"));
    else if (data.status.includes("DRAW") || data.status.includes("RESIGN") || data.status.includes("ABORT") || data.status.includes("TIME")) sfxEnd.play().catch(e => console.log("Audio blocked"));
    else if (data.status.includes("CHECK")) sfxCheck.play().catch(e => console.log("Audio blocked"));
    else if (isCapture) sfxCapture.play().catch(e => console.log("Audio blocked"));
    else sfxMove.play().catch(e => console.log("Audio blocked"));

    const statusUpper = data.status.toUpperCase();
    const isGameOver = statusUpper.includes("MATE") || statusUpper.includes("DRAW") || statusUpper.includes("RESIGN") || statusUpper.includes("ABORT") || statusUpper.includes("TIME") || statusUpper.includes("ABANDONED");

    const matchControls = document.getElementById("match-controls");
    const abortBtn = document.getElementById("btn-abort");

    if (isGameOver) {
        matchStarted = false;
        clearInterval(timerInterval);
        const matchControls = document.getElementById("match-controls");
        if (matchControls) matchControls.classList.add("hidden");
        
        let overlayTitle = "Game Over";
        let cleanMessage = data.status; 

        if (statusUpper.includes("TIME")) {
            overlayTitle = "TIME OUT";
        } else if (statusUpper.includes("ABORT")) {
            overlayTitle = "MATCH ABORTED";
        } else if (statusUpper.includes("CHECKMATE")) {
            overlayTitle = "CHECKMATE";
        } else if (statusUpper.includes("DRAW")) {
            overlayTitle = "DRAW";
        } else if (statusUpper.includes("RESIGN")) {
            overlayTitle = "RESIGNATION";
        } else if (statusUpper.includes("ABANDONED")) {
            // THE FIX: Smart Title based on who left!
            const leaver = statusUpper.includes("WHITE ABANDONED") ? "White" : "Black";
            overlayTitle = `${leaver} Abandoned!`;
        }

        // Clean up the regular statuses
        cleanMessage = cleanMessage
            .replace(/RESIGNATION!?/ig, "")
            .replace(/CHECKMATE!?/ig, "")
            .replace(/TIME OUT!?/ig, "")
            .replace(/MATCH ABORTED!?/ig, "") 
            .replace(/ABORTED!?/ig, "");
            
        // THE FIX: Override the message for Abandonment so there is no awkward punctuation
        if (statusUpper.includes("ABANDONED")) {
            const winner = statusUpper.includes("WHITE ABANDONED") ? "Black" : "White";
            cleanMessage = `${winner} wins!`;
            const sfxEnd = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/notify.mp3'); 
            sfxEnd.play().catch(e => console.log("Audio play blocked by browser:", e));
        } else {
            cleanMessage = cleanMessage.trim();
        }

        displayOverlay(`${overlayTitle}<br>${cleanMessage}`, true);
        return;
    } else {
        if (matchControls && myColor !== "SPECTATOR") matchControls.classList.remove("hidden");
        
        if (abortBtn) {
            if (moveCounter <= 2) abortBtn.classList.remove("hidden");
            else abortBtn.classList.add("hidden");
        }
        
        if (statusUpper.includes("CHECK")) highlightKingInCheck();
    }
}

function executeLocalReset() {
    document.getElementById("match-controls").classList.add("hidden"); 
    clearInterval(timerInterval);
    if (autoAbortTimer) { clearTimeout(autoAbortTimer); autoAbortTimer = null; }

    updateStatusUI("White's Turn"); 
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
    const startSquareDiv = document.getElementById(`square-${startX}-${startY}`);
    const endSquareDiv = document.getElementById(`square-${endX}-${endY}`);

    const pieceHTML = startSquareDiv.innerHTML;
    startSquareDiv.innerHTML = "";
    endSquareDiv.innerHTML = pieceHTML;

    let promotionCode = "";
    if ((pieceCode === "wP" && startX === 6 && endX === 7) || (pieceCode === "bP" && startX === 1 && endX === 0)) {
        promotionCode = await triggerPromotionUI(pieceCode[0]); 
    }

    let url = `${SERVER_URL}/move?startX=${startX}&startY=${startY}&endX=${endX}&endY=${endY}&pieceCode=${pieceCode}`;
    if (promotionCode) url += `&promotion=${promotionCode}`;

    const response = await fetch(url);
    const statusText = await response.text();
    
    if (statusText.includes("ERROR")) {
        fetchBoard(); 
        document.getElementById("status").innerText = statusText;
        startSquareDiv.classList.add("invalid-move");
        setTimeout(() => startSquareDiv.classList.remove("invalid-move"), 800);
    }
}

// ==========================================
// 5. RENDERING & UI LOGIC
// ==========================================
async function fetchBoard() {
    try {
        const response = await fetch(`${SERVER_URL}/sync?t=${new Date().getTime()}`);
        const data = await response.json();
        
        if (data.whiteTime !== undefined && data.blackTime !== undefined) {
            serverWhiteTimeMs = data.whiteTime;
            serverBlackTimeMs = data.blackTime;
            localTimerStartMs = Date.now(); 
            updateClockUI();
        }

        document.getElementById("move-log").innerHTML = "";
        moveCounter = 1;
        boardHistory = [INITIAL_BOARD]; 
        
        if (data.moveHistory && data.moveHistory.length > 0) {
            const lastMove = data.moveHistory[data.moveHistory.length - 1];
            lastPlayedMove = { startX: lastMove.startX, startY: lastMove.startY, endX: lastMove.endX, endY: lastMove.endY };

            data.moveHistory.forEach(move => {
                logAlgebraicNotation(move.pieceCode, move.startX, move.startY, move.endX, move.endY, move.status, move.promotion);
                boardHistory.push(move.grid);
                lastKnownStatus = move.status;
            });
        } else {
            lastPlayedMove = null;
        }
        
        boardHistory[boardHistory.length - 1] = data.grid;
        currentViewIndex = boardHistory.length - 1;
        
        updateStatusUI(lastKnownStatus);
        drawBoard(data.grid);
        highlightLastMoveSquares();
        highlightKingInCheck();
        updateMaterial(data.grid);

        const statusUpper = lastKnownStatus.toUpperCase();
        const isGameOver = statusUpper.includes("MATE") || statusUpper.includes("DRAW") || statusUpper.includes("RESIGN") || statusUpper.includes("ABORT") || statusUpper.includes("TIME") || statusUpper.includes("ABANDONED");

        if (isGameOver) {
            matchStarted = false;
            clearInterval(timerInterval);
            const matchControls = document.getElementById("match-controls");
            if (matchControls) matchControls.classList.add("hidden");
            
            let overlayTitle = "Game Over";
            let cleanMessage = lastKnownStatus; 

            if (statusUpper.includes("TIME")) {
                overlayTitle = "TIME OUT";
            } else if (statusUpper.includes("ABORT")) {
                overlayTitle = "MATCH ABORTED";
            } else if (statusUpper.includes("CHECKMATE")) {
                overlayTitle = "CHECKMATE";
            } else if (statusUpper.includes("DRAW")) {
                overlayTitle = "DRAW";
            } else if (statusUpper.includes("RESIGN")) {
                overlayTitle = "RESIGNATION";
            } else if (statusUpper.includes("ABANDONED")) {
                // THE FIX: Smart Title based on who left!
                const leaver = statusUpper.includes("WHITE ABANDONED") ? "White" : "Black";
                overlayTitle = `${leaver} Abandoned!`;
            }

            // Clean up the regular statuses
            cleanMessage = cleanMessage
                .replace(/RESIGNATION!?/ig, "")
                .replace(/CHECKMATE!?/ig, "")
                .replace(/TIME OUT!?/ig, "")
                .replace(/MATCH ABORTED!?/ig, "") 
                .replace(/ABORTED!?/ig, "");
                
            // THE FIX: Override the message for Abandonment so there is no awkward punctuation
            if (statusUpper.includes("ABANDONED")) {
                const winner = statusUpper.includes("WHITE ABANDONED") ? "Black" : "White";
                cleanMessage = `${winner} wins!`;
            } else {
                cleanMessage = cleanMessage.trim();
            }

            displayOverlay(`${overlayTitle}<br>${cleanMessage}`, true);
        } else {
            // THE FIX: Unconditionally sync timers and UI controls if game is active
            if (data.whiteTime !== undefined && data.blackTime !== undefined) {
                serverWhiteTimeMs = data.whiteTime;
                serverBlackTimeMs = data.blackTime;
                localTimerStartMs = Date.now(); 
                updateClockUI();
            }

            clearInterval(timerInterval);
            
            // Start the timers visually IF the match is flagged as started by the server
            if (data.matchStarted) {
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
            
            if (statusUpper.includes("CHECK")) highlightKingInCheck();
        }
    } catch (error) {
        console.log("Fetch error:", error);
    }
}

// THEME SWITCHER LOGIC
const themes = {
    wood: { light: "#f0d9b5", dark: "#b58863", highlight: "rgba(255, 170, 0, 0.45)" },
    ocean: { light: "#dee3e6", dark: "#8ca2ad", highlight: "rgba(52, 152, 219, 0.5)" },
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
    if (currentViewIndex === boardHistory.length - 1 && lastPlayedMove) {
        const startSquare = document.getElementById(`square-${lastPlayedMove.startX}-${lastPlayedMove.startY}`);
        const endSquare = document.getElementById(`square-${lastPlayedMove.endX}-${lastPlayedMove.endY}`);

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
    boardDiv.innerHTML = ""; 

    let rows = [7, 6, 5, 4, 3, 2, 1, 0];
    let cols = [0, 1, 2, 3, 4, 5, 6, 7];
    const fileNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    if (myColor === "BLACK") {
        rows.reverse();
        cols.reverse();
    }

    for (let row of rows) {
        for (let col of cols) {
            const square = document.createElement("div");
            square.className = `square ${(row + col) % 2 === 0 ? 'dark' : 'light'}`;
            square.id = `square-${row}-${col}`;
            square.style.position = "relative"; 

            const pieceCode = grid[row][col];

            square.addEventListener("dragover", e => e.preventDefault());
            square.addEventListener("dragenter", e => e.currentTarget.classList.add("drag-over"));
            square.addEventListener("dragleave", e => e.currentTarget.classList.remove("drag-over"));
            square.addEventListener("drop", (e) => handleDrop(e, row, col));
            square.onclick = () => handleSquareClick(row, col, square, pieceCode);

            if (row === rows[7]) {
                const fileLabel = document.createElement("span");
                fileLabel.className = "coord-file";
                fileLabel.innerText = fileNames[col];
                square.appendChild(fileLabel);
            }

            if (col === cols[0]) {
                const rankLabel = document.createElement("span");
                rankLabel.className = "coord-rank";
                rankLabel.innerText = row + 1;
                square.appendChild(rankLabel);
            }

            if (pieceCode) {
                // THE FIX: Use <img> instead of <span>
                const pieceImg = document.createElement("img");
                pieceImg.className = "piece-symbol";
                pieceImg.src = pieceImages[pieceCode]; // Load the SVG URL
                pieceImg.draggable = true;
                
                pieceImg.addEventListener("dragstart", (e) => {
                    if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
                        e.preventDefault(); 
                        return;
                    }
                    if (currentViewIndex < boardHistory.length - 1) { e.preventDefault(); return; }
                    if (selectedSquare) { selectedSquare.div.classList.remove("selected"); selectedSquare = null; }
                    e.dataTransfer.setData("text/plain", JSON.stringify({ startX: row, startY: col, piece: pieceCode }));
                    setTimeout(() => pieceImg.classList.add("dragging"), 0);
                    showValidMoves(row, col);
                });

                pieceImg.addEventListener("dragend", () => pieceImg.classList.remove("dragging"));
                square.appendChild(pieceImg);
            }
            boardDiv.appendChild(square);
        }
    }
}

function handleSquareClick(row, col, squareDiv, pieceCode) {
    if (currentViewIndex < boardHistory.length - 1) return;
    if (selectedSquare === null) {
        if (pieceCode !== "") {
            if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) { return; }
            selectedSquare = { x: row, y: col, div: squareDiv, piece: pieceCode };
            squareDiv.classList.add("selected");
            showValidMoves(row, col);
        }
    } else {
        const startX = selectedSquare.x; const startY = selectedSquare.y; const movingPiece = selectedSquare.piece;
        selectedSquare.div.classList.remove("selected"); selectedSquare = null;
        clearValidMoves(); 
        if (startX === row && startY === col) return;
        attemptMove(startX, startY, row, col, movingPiece);
    }
}

function handleDrop(e, endX, endY) {
    e.preventDefault(); e.currentTarget.classList.remove("drag-over"); 
    if (currentViewIndex < boardHistory.length - 1) return;
    const dragData = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (dragData.startX === endX && dragData.startY === endY) return;
    attemptMove(dragData.startX, dragData.startY, endX, endY, dragData.piece);
}

function updateMaterial(grid) {
    let whitePoints = 0; let blackPoints = 0;
    let whiteCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 }; let blackCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 };

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = grid[r][c];
            if (p && p[1] !== 'K') {
                if (p[0] === 'w') { whitePoints += pieceValues[p[1]]; whiteCounts[p[1]]++; } 
                else { blackPoints += pieceValues[p[1]]; blackCounts[p[1]]++; }
            }
        }
    }

    let capturedByBlack = []; let capturedByWhite = [];
    for (const type in startingCounts) {
        let missingWhite = Math.max(0, startingCounts[type] - whiteCounts[type]);
        for (let i = 0; i < missingWhite; i++) capturedByBlack.push('w' + type);
        let missingBlack = Math.max(0, startingCounts[type] - blackCounts[type]);
        for (let i = 0; i < missingBlack; i++) capturedByWhite.push('b' + type);
    }

    const diff = whitePoints - blackPoints;
    let whiteAdvantage = diff > 0 ? `+${diff}` : ""; let blackAdvantage = diff < 0 ? `+${Math.abs(diff)}` : "";

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

    // THE FIX: This loop now creates <img> tags instead of <span> tags!
    pieces.forEach(p => {
        const img = document.createElement("img"); 
        img.src = pieceImages[p];
        img.className = 'captured-piece'; 
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
    const boardDiv = document.getElementById("chessboard"); const statusDiv = document.getElementById("status");
    if (currentViewIndex < boardHistory.length - 1) {
        boardDiv.classList.add("review-mode"); statusDiv.innerText = `REVIEW MODE: Viewing Move ${currentViewIndex}`; hideOverlay(); 
    } else {
        boardDiv.classList.remove("review-mode"); statusDiv.innerText = lastKnownStatus;
    }
    
    drawBoard(boardHistory[currentViewIndex]);
    highlightLastMoveSquares();
    highlightKingInCheck(); 
    updateMaterial(boardHistory[currentViewIndex]); 
}

function viewPrevious() { if (currentViewIndex > 0) { currentViewIndex--; updateTimelineUI(); } }
function viewNext() { if (currentViewIndex < boardHistory.length - 1) { currentViewIndex++; updateTimelineUI(); } }
function viewFirst() { if (currentViewIndex !== 0) { currentViewIndex = 0; updateTimelineUI(); } }
function viewLive() {
    if (currentViewIndex !== boardHistory.length - 1) {
        currentViewIndex = boardHistory.length - 1; updateTimelineUI();
        if (lastKnownStatus.includes("CHECKMATE") || lastKnownStatus.includes("DRAW")) {
            const msg = lastKnownStatus.includes("CHECKMATE") ? `CHECKMATE!<br>${lastKnownStatus.includes("WHITE") ? "White" : "Black"} wins!` : `${lastKnownStatus.replace("DRAW! ", "")}<br>Game is a Draw.`;
            displayOverlay(msg);
        }
    }
}

function triggerPromotionUI(colorChar) {
    return new Promise((resolve) => {
        const modal = document.getElementById("promotion-modal"); const optionsDiv = document.getElementById("promotion-options"); optionsDiv.innerHTML = ""; 
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
        const hintDot = document.createElement("div"); hintDot.className = "valid-move-hint"; square.appendChild(hintDot);
    });
}

function clearValidMoves() { document.querySelectorAll(".valid-move-hint").forEach(dot => dot.remove()); }

function logAlgebraicNotation(pieceCode, startX, startY, endX, endY, statusText, promotionCode) {
    if (!pieceCode) return;
    const startSquare = `${String.fromCharCode(97 + startY)}${startX + 1}`; const endSquare = `${String.fromCharCode(97 + endY)}${endX + 1}`;
    let notation = `${moveCounter}. ${pieceMap[pieceCode]} ${startSquare} → ${endSquare}`;
    if (promotionCode) notation += `=${pieceMap[pieceCode[0] + promotionCode]}`;
    if (statusText.includes("CHECKMATE")) notation += " #"; else if (statusText.includes("CHECK")) notation += " +"; else if (statusText.includes("DRAW")) notation += " ½-½";

    const logDiv = document.getElementById("move-log"); const entry = document.createElement("div");
    entry.className = "log-entry"; entry.innerText = notation; logDiv.appendChild(entry); logDiv.scrollTop = logDiv.scrollHeight; 
    moveCounter++;
}

function highlightKingInCheck() {
    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));

    const upperText = lastKnownStatus.toUpperCase();
    if (!upperText.includes("CHECK")) return;

    let targetKing = "";
    if (upperText.includes("CHECKMATE")) targetKing = upperText.includes("WHITE") ? "bK" : "wK";
    else targetKing = upperText.includes("WHITE") ? "wK" : "bK";

    const currentGrid = boardHistory[currentViewIndex];
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
function hideOverlay() { document.getElementById("overlay").classList.add("hidden"); }

// ==========================================
// 6. TIMERS & CLOCK LOGIC
// ==========================================
function startTimers() {
    clearInterval(timerInterval); 

    if (lastKnownStatus.includes("CHECKMATE") || lastKnownStatus.includes("DRAW") || lastKnownStatus.includes("TIME_OUT") || lastKnownStatus.includes("ABORTED") || lastKnownStatus.includes("RESIGNATION")) {
        return; 
    }

    timerInterval = setInterval(() => {
        const statusUpper = lastKnownStatus.toUpperCase();
        const elapsedLocalMs = Date.now() - localTimerStartMs;
        let displayWhiteMs = serverWhiteTimeMs;
        let displayBlackMs = serverBlackTimeMs;

        if (statusUpper.includes("WHITE")) displayWhiteMs -= elapsedLocalMs;
        else if (statusUpper.includes("BLACK")) displayBlackMs -= elapsedLocalMs;
        
        updateClockUI(displayWhiteMs, displayBlackMs);

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
    const wClock = document.getElementById("white-clock"); const bClock = document.getElementById("black-clock");
    wClock.innerText = formatTime(wMs); bClock.innerText = formatTime(bMs);
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