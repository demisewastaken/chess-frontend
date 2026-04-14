// ==========================================
// 1. CONFIGURATION & VARIABLES
// ==========================================
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PROD_BACKEND_URL = "https://dichess.onrender.com"; 
const SERVER_URL = isLocal ? "http://localhost:8080" : PROD_BACKEND_URL;

const pieceMap = { "wK": "♔", "wQ": "♕", "wR": "♖", "wB": "♗", "wN": "♘", "wP": "♙", "bK": "♚", "bQ": "♛", "bR": "♜", "bB": "♝", "bN": "♞", "bP": "♟", "": "" };
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

// LOBBY & CLOCK VARIABLES
let myColor = "SPECTATOR";
let matchStarted = false; 
let autoAbortTimer = null; 

// --- REAL-TIME CLOCK VARIABLES ---
let serverWhiteTimeMs = 600000; 
let serverBlackTimeMs = 600000;
let localTimerStartMs = Date.now(); // Tracks the exact millisecond the server last synced
let timerInterval = null;
let stompClient = null;

// --- Master Status Controller ---
function updateStatusUI(text) {
    lastKnownStatus = text;
    const statusDiv = document.getElementById("status");
    
    if (myColor === "SPECTATOR") {
        // Intercept the text and add a permanent gold Spectator badge!
        statusDiv.innerHTML = `<span style="color: #f1c40f;">👁️ SPECTATING</span> | ${text}`;
    } else {
        statusDiv.innerText = text;
    }
}

// ==========================================
// 2. INITIALIZATION & LOBBY SYSTEM
// ==========================================
async function joinGame() {
    // 1. Check if we have a secret token saved in the browser's local memory
    let savedToken = localStorage.getItem("chessToken") || "";
    
    // 2. Send the token (if we have one) to Java
    const response = await fetch(`${SERVER_URL}/join?token=${savedToken}`);
    const tokenResponse = await response.text(); 
    
    // 3. Figure out who we are based on Java's response
    if (tokenResponse.startsWith("WHITE")) {
        myColor = "WHITE";
        localStorage.setItem("chessToken", tokenResponse); // Save the token securely!
    } else if (tokenResponse.startsWith("BLACK")) {
        myColor = "BLACK";
        localStorage.setItem("chessToken", tokenResponse); // Save the token securely!
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
}

async function declareReady() {
    displayOverlay("Waiting for opponent to ready up...");
    await fetch(`${SERVER_URL}/ready?color=${myColor}`);
}

function connectWebSocket() {
    const socket = new SockJS(`${SERVER_URL}/ws`);
    stompClient = Stomp.over(socket);
    stompClient.debug = null; 

    stompClient.connect({}, function (frame) {
        stompClient.subscribe('/topic/game', function (message) {
            const data = JSON.parse(message.body);
            
            if (data.type === "RESET") {
                executeLocalReset();
            } else if (data.type === "START") {
                startOfficialMatch(); 
            } else if (data.type === "MOVE") {
                executeLiveMoveUpdate(data);
            } else if (data.type === "KICK") {
                // THE FIX: If someone clicks "Leave Table", refresh everyone's browser 
                // so the spectators have a chance to steal the empty seats!
                window.location.reload(); 
            }
        });
    });
}

// ==========================================
// 3. MATCH FLOW LOGIC
// ==========================================
function startOfficialMatch() {
    matchStarted = true;
    hideOverlay();
    document.getElementById("match-controls").classList.remove("hidden");
    
    localTimerStartMs = Date.now();

    startTimers(); 

    // THE 10-SECOND AUTO-ABORT
    autoAbortTimer = setTimeout(() => {
        if (moveCounter === 1) { 
            // We pass "true" to skip the confirmation popup!
            sendAction("ABORT", true); 
        }
    }, 10000); 
}

// Added the 'skipConfirmation' parameter (defaults to false for button clicks)
async function sendAction(actionType, skipConfirmation = false) {
    if (myColor === "SPECTATOR") return;

    // Only show the popup if we ARE NOT skipping confirmation
    if (!skipConfirmation) {
        const actionWord = actionType === "RESIGN" ? "resign" : "abort the game";
        const userConfirmed = window.confirm(`Are you sure you want to ${actionWord}?`);
        
        if (!userConfirmed) {
            return; // Kill the function if they cancel
        }
    }

    // If they confirmed (or if it was an auto-abort), execute the action!
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
        // White moved. Pass the bomb to Black, but KEEP the button visible!
        autoAbortTimer = setTimeout(() => {
            if (moveCounter === 2) { 
                sendAction("ABORT", true);
            }
        }, 10000);
    } else if (moveCounter > 2) {
        // Both players have moved. NOW we hide the abort button permanently.
        autoAbortTimer = null;
        document.getElementById("btn-abort").classList.add("hidden"); 
    }

    // Sync the true server clocks!
    if (data.whiteTime !== undefined && data.blackTime !== undefined) {
        serverWhiteTimeMs = data.whiteTime;
        serverBlackTimeMs = data.blackTime;
        localTimerStartMs = Date.now(); // Sync our local stopwatch!
        updateClockUI(); 
        startTimers(); 
    }

    boardHistory.push(data.grid);
    currentViewIndex = boardHistory.length - 1;

    drawBoard(data.grid);
    updateMaterial(data.grid);

    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));

    if (data.status.includes("TIME_OUT")) {
        const winner = data.status.includes("White wins") ? "White" : "Black";
        displayOverlay(`TIME OUT!<br>${winner} wins!`, true);
    } else if (data.status.includes("ABORTED")) {
        displayOverlay(`MATCH ABORTED<br>Game cancelled.`, true);
        matchStarted = false;
        clearInterval(timerInterval); 
    } else if (data.status.includes("CHECKMATE")) {
        const winner = data.status.includes("WHITE wins") ? "White" : "Black";
        displayOverlay(`CHECKMATE!<br>${winner} wins!`, true);
        highlightKingInCheck(data.status, data.grid);
    } else if (data.status.includes("DRAW")) {
        displayOverlay(`${data.status.replace("DRAW! ", "")}<br>Game is a Draw.`, true);
    } else if (data.status.includes("CHECK")) {
        highlightKingInCheck(data.status, data.grid);
    } else if (data.status.includes("RESIGNATION")) {
        const winner = data.status.includes("BLACK wins") ? "Black" : "White";
        displayOverlay(`RESIGNATION<br>${winner} wins!`, true);
        matchStarted = false;
        clearInterval(timerInterval); 
        document.getElementById("match-controls").classList.add("hidden"); 
    }
}

function executeLocalReset() {
    document.getElementById("match-controls").classList.add("hidden"); 
    
    clearInterval(timerInterval);
    if (autoAbortTimer) {
        clearTimeout(autoAbortTimer);
        autoAbortTimer = null;
    }

    // Securely update the status bar
    updateStatusUI("White's Turn"); 

    document.getElementById("move-log").innerHTML = ""; 
    moveCounter = 1;
    selectedSquare = null;
    boardHistory = [];
    currentViewIndex = -1;
    matchStarted = false;
    
    // Reset the real-time trackers
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

// ==========================================
// 4. ACTION FUNCTIONS (Optimistic UI)
// ==========================================
async function attemptMove(startX, startY, endX, endY, pieceCode) {
    if (!matchStarted) return; // Prevent any movement in the lobby!

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

async function resetGame() {
    await fetch(`${SERVER_URL}/reset`);
}

async function leaveTable() {
    // 1. Delete the local token from the player's browser
    localStorage.removeItem("chessToken"); 
    
    // 2. Tell Java to wipe the seats and kick everyone
    await fetch(`${SERVER_URL}/leave`); 
}

// ==========================================
// 5. RENDERING & UI LOGIC
// ==========================================
async function fetchBoard() {
    try {
        const response = await fetch(`${SERVER_URL}/sync?t=${new Date().getTime()}`);
        const data = await response.json();
        
        // 1. Instantly sync the true server clocks!
        if (data.whiteTime !== undefined && data.blackTime !== undefined) {
            serverWhiteTimeMs = data.whiteTime;
            serverBlackTimeMs = data.blackTime;
            localTimerStartMs = Date.now(); // Sync our local stopwatch!
            updateClockUI();
        }

        // 2. REBUILD THE PAST FROM THE SERVER MEMORY
        document.getElementById("move-log").innerHTML = "";
        moveCounter = 1;
        boardHistory = [INITIAL_BOARD]; 
        
        if (data.moveHistory && data.moveHistory.length > 0) {
            // Fast-forward through every move that happened
            data.moveHistory.forEach(move => {
                logAlgebraicNotation(move.pieceCode, move.startX, move.startY, move.endX, move.endY, move.status, move.promotion);
                boardHistory.push(move.grid);
                lastKnownStatus = move.status;
            });
        }
        
        // 3. Ensure the current grid perfectly matches Java
        boardHistory[boardHistory.length - 1] = data.grid;
        currentViewIndex = boardHistory.length - 1;
        
        // 4. Update the UI
        updateStatusUI(lastKnownStatus);
        drawBoard(data.grid);
        updateMaterial(data.grid);

        // 5. If the game is actively running, ensure the clocks are visually ticking!
        if (moveCounter > 1 && !lastKnownStatus.includes("CHECKMATE") && !lastKnownStatus.includes("DRAW") && !lastKnownStatus.includes("ABORT") && !lastKnownStatus.includes("RESIGN")) {
            startTimers();
        }
        // ==========================================
        // 6. NEW: BYPASS THE LOBBY ON REFRESH!
        // ==========================================
        if (data.matchStarted && myColor !== "SPECTATOR") {
            matchStarted = true;
            hideOverlay(); // Shatter the "I am Ready" screen!
            document.getElementById("match-controls").classList.remove("hidden"); // Bring back the abort/resign buttons
            // THE FIX: If more than 2 moves have happened, hide the Abort button!
            // Remember: moveCounter starts at 1, so moveCounter > 2 means both have moved.
            if (moveCounter > 2) {
                document.getElementById("btn-abort").classList.add("hidden");
            }
        }

    } catch (error) {
        document.getElementById("status").innerText = "Error connecting to server.";
    }
}

function drawBoard(grid) {
    const boardDiv = document.getElementById("chessboard");
    boardDiv.innerHTML = ""; 

    for (let row = 7; row >= 0; row--) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("div");
            square.className = `square ${(row + col) % 2 === 0 ? 'dark' : 'light'}`;
            square.id = `square-${row}-${col}`;

            const pieceCode = grid[row][col];

            square.addEventListener("dragover", e => e.preventDefault());
            square.addEventListener("dragenter", e => e.currentTarget.classList.add("drag-over"));
            square.addEventListener("dragleave", e => e.currentTarget.classList.remove("drag-over"));
            square.addEventListener("drop", (e) => handleDrop(e, row, col));
            square.onclick = () => handleSquareClick(row, col, square, pieceCode);

            if (pieceCode) {
                const pieceSpan = document.createElement("span");
                pieceSpan.className = `piece-symbol ${pieceCode[0] === 'w' ? 'white-piece' : 'black-piece'}`;
                pieceSpan.innerText = pieceMap[pieceCode];
                pieceSpan.draggable = true;
                
                pieceSpan.addEventListener("dragstart", (e) => {
                    if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
                        e.preventDefault(); 
                        return;
                    }
                    if (currentViewIndex < boardHistory.length - 1) { e.preventDefault(); return; }
                    if (selectedSquare) { selectedSquare.div.classList.remove("selected"); selectedSquare = null; }
                    e.dataTransfer.setData("text/plain", JSON.stringify({ startX: row, startY: col, piece: pieceCode }));
                    setTimeout(() => pieceSpan.classList.add("dragging"), 0);
                    showValidMoves(row, col);
                });

                pieceSpan.addEventListener("dragend", () => pieceSpan.classList.remove("dragging"));
                square.appendChild(pieceSpan);
            }
            boardDiv.appendChild(square);
        }
    }
}

function handleSquareClick(row, col, squareDiv, pieceCode) {
    if (currentViewIndex < boardHistory.length - 1) return;
    if (selectedSquare === null) {
        if (pieceCode !== "") {
            if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
                return; 
            }
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
    
    // ==========================================
    // THE FIX: Hide the box if it is completely empty!
    // ==========================================
    if (pieces.length === 0 && !advantage) {
        container.style.display = "none";
        return; // Stop the function here, we don't need to do anything else!
    } else {
        container.style.display = "flex"; // Bring the box back!
    }

    const sortOrder = { 'Q': 1, 'R': 2, 'B': 3, 'N': 4, 'P': 5 };
    pieces.sort((a, b) => sortOrder[a[1]] - sortOrder[b[1]]);

    pieces.forEach(p => {
        const span = document.createElement("span"); span.innerText = pieceMap[p];
        span.className = p[0] === 'w' ? 'captured-white' : 'captured-black';
        container.appendChild(span);
    });

    if (advantage) {
        const advSpan = document.createElement("span"); advSpan.className = "advantage-score"; advSpan.innerText = advantage;
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
    updateMaterial(boardHistory[currentViewIndex]); 
    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));
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
            const btn = document.createElement("div"); btn.className = "promo-choice";
            const pieceCode = colorChar + type; btn.className += (colorChar === 'w') ? " white-piece" : " black-piece";
            btn.innerText = pieceMap[pieceCode];
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

function highlightKingInCheck(text, grid) {
    let colorToHighlight = text.includes("wins") ? (text.includes("WHITE") ? "bK" : "wK") : (text.includes("BLACK") ? "bK" : "wK");
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (grid[r][c] === colorToHighlight) { document.getElementById(`square-${r}-${c}`).classList.add("check-square"); return; }
        }
    }
}

// We can now tell the overlay whether or not to generate a Play Again button!
// We can now tell the overlay whether or not to generate the post-game buttons!
function displayOverlay(message, showReset = false) { 
    let finalHtml = message;
    
    // Only show the buttons if requested AND if they are an actual player!
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
// 6. TIMERS & CLOCK LOGIC (DELTA TIME MATH)
// ==========================================
function startTimers() {
    clearInterval(timerInterval); 

    if (lastKnownStatus.includes("CHECKMATE") || lastKnownStatus.includes("DRAW") || lastKnownStatus.includes("TIME_OUT") || lastKnownStatus.includes("ABORTED") || lastKnownStatus.includes("RESIGNATION")) {
        return; 
    }

    // Run the UI update very fast (every 200ms) for maximum smoothness
    timerInterval = setInterval(() => {
        const statusUpper = lastKnownStatus.toUpperCase();
        
        // Calculate the EXACT mathematical time that has passed in the real world
        const elapsedLocalMs = Date.now() - localTimerStartMs;

        let displayWhiteMs = serverWhiteTimeMs;
        let displayBlackMs = serverBlackTimeMs;

        // Only subtract the elapsed time from the player whose turn it currently is
        if (statusUpper.includes("WHITE")) {
            displayWhiteMs -= elapsedLocalMs;
        } else if (statusUpper.includes("BLACK")) {
            displayBlackMs -= elapsedLocalMs;
        }
        
        updateClockUI(displayWhiteMs, displayBlackMs);

        if (displayWhiteMs <= 0 || displayBlackMs <= 0) {
            clearInterval(timerInterval);
            fetch(`${SERVER_URL}/timeout`);
        }
    }, 200); 
}

// Now accepts raw milliseconds and formats them mathematically
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

    // Pulse red if under 30,000 milliseconds (30 seconds)
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

// ==========================================
// 8. BROWSER TAB SYNC (Fixes sleepy clocks!)
// ==========================================
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        // The moment the user clicks back to this tab, ask Java for the true time!
        fetchBoard(); 
    }
});