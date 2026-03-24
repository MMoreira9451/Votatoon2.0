const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// ─── State ───────────────────────────────────────────────────────────
const state = {
  // Categories
  categories: ["vestimenta", "presentacion"],
  currentCategory: "vestimenta",
  categoryModes: { vestimenta: "tournament", presentacion: "popular" },

  // Contestants per category: { vestimenta: [{name, id}], presentacion: [{name, id}] }
  contestants: { vestimenta: [], presentacion: [] },

  // Bracket per category: array of rounds, each round is array of matches
  // match = { a: id, b: id, votes: { [id]: count }, winner: null }
  brackets: { vestimenta: [], presentacion: [] },
  currentRound: { vestimenta: 0, presentacion: 0 },
  currentMatch: { vestimenta: 0, presentacion: 0 },

  // Voting
  votingOpen: false,
  categoryVotes: { vestimenta: {}, presentacion: {} },
  categoryCompleted: { vestimenta: false, presentacion: false },
  categoryResolvedWinner: { vestimenta: null, presentacion: null },

  // Tie-break roulette
  tieBreak: null,

  // Who voted in the current match: Set of socket ids
  voted: new Set(),

  // Registration open
  registrationOpen: true,

  // Final winner announced
  announcedWinner: null, // { name, category }

  // Connected users
  users: {}, // socketId -> { role, name, category? }
};

// ─── Helpers ─────────────────────────────────────────────────────────
function buildBracket(category) {
  const list = state.contestants[category];
  if (list.length < 2) return;

  // Shuffle
  const shuffled = [...list].sort(() => Math.random() - 0.5);

  // Pad to power of 2
  let size = 1;
  while (size < shuffled.length) size *= 2;
  while (shuffled.length < size) shuffled.push({ name: "BYE", id: "bye_" + Math.random() });

  // Build first round
  const round = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    round.push({
      a: shuffled[i],
      b: shuffled[i + 1],
      votes: {},
      winner: null,
    });
  }
  state.brackets[category] = [round];
  state.currentRound[category] = 0;
  state.currentMatch[category] = 0;

  // Auto-resolve BYE matches
  for (const match of round) {
    if (match.a.id.startsWith("bye_")) {
      match.winner = match.b.id;
    } else if (match.b.id.startsWith("bye_")) {
      match.winner = match.a.id;
    }
    match.votes[match.a.id] = 0;
    match.votes[match.b.id] = 0;
  }

  // Advance past BYE matches
  advancePastByes(category);
}

function advancePastByes(category) {
  const bracket = state.brackets[category];
  const roundIdx = state.currentRound[category];
  const round = bracket[roundIdx];
  if (!round) return;

  let matchIdx = state.currentMatch[category];
  while (matchIdx < round.length && round[matchIdx].winner) {
    matchIdx++;
  }
  state.currentMatch[category] = matchIdx;

  // If all matches done in this round, build next round
  if (matchIdx >= round.length) {
    buildNextRound(category);
  }
}

function buildNextRound(category) {
  const bracket = state.brackets[category];
  const roundIdx = state.currentRound[category];
  const round = bracket[roundIdx];
  if (!round) return;

  const winners = round.map((m) => {
    const all = [...state.contestants[category], ...round.flatMap(mm => [mm.a, mm.b])];
    return all.find((c) => c.id === m.winner) || m.a;
  });

  if (winners.length <= 1) {
    // Final winner!
    return;
  }

  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (i + 1 < winners.length) {
      const match = {
        a: winners[i],
        b: winners[i + 1],
        votes: {},
        winner: null,
      };
      match.votes[winners[i].id] = 0;
      match.votes[winners[i + 1].id] = 0;

      // Auto-resolve BYEs
      if (winners[i].id.startsWith("bye_")) match.winner = winners[i + 1].id;
      else if (winners[i + 1].id.startsWith("bye_")) match.winner = winners[i].id;

      nextRound.push(match);
    } else {
      // Odd one out gets a bye
      nextRound.push({
        a: winners[i],
        b: { name: "BYE", id: "bye_" + Math.random() },
        votes: { [winners[i].id]: 0 },
        winner: winners[i].id,
      });
    }
  }

  bracket.push(nextRound);
  state.currentRound[category] = bracket.length - 1;
  state.currentMatch[category] = 0;

  advancePastByes(category);
}

function getCurrentMatch(category) {
  if (state.categoryModes[category] !== "tournament") return null;
  const bracket = state.brackets[category];
  const roundIdx = state.currentRound[category];
  const matchIdx = state.currentMatch[category];
  if (!bracket[roundIdx]) return null;
  return bracket[roundIdx][matchIdx] || null;
}

function getCategoryLeaderboard(category) {
  const votes = state.categoryVotes[category] || {};
  return [...state.contestants[category]]
    .map((contestant) => ({
      ...contestant,
      votes: votes[contestant.id] || 0,
    }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.name.localeCompare(b.name);
    });
}

function getCategoryWinner(category) {
  if (state.categoryModes[category] === "popular") {
    if (!state.categoryCompleted[category]) return null;
    if (state.categoryResolvedWinner[category]) {
      return state.contestants[category].find((c) => c.id === state.categoryResolvedWinner[category]) || null;
    }
    const leaderboard = getCategoryLeaderboard(category);
    if (!leaderboard.length) return null;
    if (leaderboard[0].votes <= 0) return null;
    return leaderboard[0];
  }

  const bracket = state.brackets[category];
  if (!bracket || bracket.length === 0) return null;
  const lastRound = bracket[bracket.length - 1];
  if (lastRound.length === 1 && lastRound[0].winner) {
    const all = state.contestants[category];
    return all.find((c) => c.id === lastRound[0].winner) || null;
  }
  return null;
}

function getFullState() {
  return {
    categories: state.categories,
    currentCategory: state.currentCategory,
    contestants: state.contestants,
    brackets: state.brackets,
    currentRound: state.currentRound,
    currentMatch: state.currentMatch,
    votingOpen: state.votingOpen,
    categoryModes: state.categoryModes,
    categoryVotes: state.categoryVotes,
    categoryCompleted: state.categoryCompleted,
    categoryResolvedWinner: state.categoryResolvedWinner,
    categoryLeaderboard: getCategoryLeaderboard(state.currentCategory),
    tieBreak: state.tieBreak,
    registrationOpen: state.registrationOpen,
    announcedWinner: state.announcedWinner,
    currentMatchData: getCurrentMatch(state.currentCategory),
    categoryWinner: getCategoryWinner(state.currentCategory),
  };
}

function createTieBreak(category, candidates, context) {
  state.tieBreak = {
    active: true,
    spinning: false,
    category,
    candidates,
    context,
  };
}

function clearTieBreak() {
  state.tieBreak = null;
}

function resolveTournamentTieBreak(winnerId) {
  const tieBreak = state.tieBreak;
  if (!tieBreak) return null;

  const category = tieBreak.category;
  const match = getCurrentMatch(category);
  if (!match) return null;

  match.winner = winnerId;
  state.currentMatch[category]++;
  const bracket = state.brackets[category];
  const round = bracket[state.currentRound[category]];
  if (state.currentMatch[category] >= round.length) {
    buildNextRound(category);
  }

  const winner = winnerId === match.a.id ? match.a : match.b;
  clearTieBreak();
  return { winner, match, category };
}

function resolvePopularTieBreak(winnerId) {
  const tieBreak = state.tieBreak;
  if (!tieBreak) return null;

  const category = tieBreak.category;
  state.categoryCompleted[category] = true;
  state.categoryResolvedWinner[category] = winnerId;
  const winner = state.contestants[category].find((c) => c.id === winnerId) || null;
  clearTieBreak();
  return { winner, category, leaderboard: getCategoryLeaderboard(category) };
}

// ─── Socket.IO ───────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Register user
  socket.on("register", ({ role, name, category, adminKey }) => {
    const normalizedName = typeof name === "string" ? name.trim() : "";

    // Only allow presenter role with correct admin key
    if (role === "presenter" && adminKey !== "votatoon2026") {
      socket.emit("registerError", "Acceso de presentador no autorizado");
      return;
    }

    if (!normalizedName) {
      socket.emit("registerError", "Debes ingresar un nombre");
      return;
    }

    if (!["voter", "contestant", "presenter"].includes(role)) {
      socket.emit("registerError", "Rol no valido");
      return;
    }

    if (role === "contestant") {
      if (!state.registrationOpen) {
        socket.emit("registerError", "Las inscripciones estan cerradas");
        return;
      }

      if (!state.categories.includes(category)) {
        socket.emit("registerError", "Categoria no valida");
        return;
      }

      const duplicate = state.contestants[category].find(
        (c) => c.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (duplicate) {
        socket.emit("registerError", "Ya existe un concursante con ese nombre en esta categoria");
        return;
      }
    }

    state.users[socket.id] = { role, name: normalizedName, category };

    if (role === "contestant" && category) {
      const id = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const contestant = { name: normalizedName, id };
      state.contestants[category].push(contestant);
      socket.contestantId = id;
      socket.contestantCategory = category;
    }

    socket.emit("state", getFullState());
    socket.emit("registered", { role, name: normalizedName });
    io.emit("state", getFullState());
  });

  // Presenter: toggle registration
  socket.on("toggleRegistration", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.registrationOpen = !state.registrationOpen;
    io.emit("state", getFullState());
  });

  // Presenter: build brackets and start tournament
  socket.on("startTournament", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.registrationOpen = false;
    state.categoryCompleted.presentacion = false;
    state.categoryResolvedWinner.presentacion = null;
    clearTieBreak();
    state.categoryVotes.presentacion = Object.fromEntries(
      state.contestants.presentacion.map((contestant) => [contestant.id, 0])
    );

    for (const cat of state.categories) {
      if (state.categoryModes[cat] === "tournament" && state.contestants[cat].length >= 2) {
        buildBracket(cat);
      }
    }
    io.emit("state", getFullState());
  });

  // Presenter: open voting for current match
  socket.on("openVoting", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    const category = state.currentCategory;
    if (state.tieBreak?.active) return;

    if (state.categoryModes[category] === "popular") {
      if (state.categoryCompleted[category]) return;
      if (state.contestants[category].length === 0) return;
    } else {
      const match = getCurrentMatch(category);
      if (!match || match.winner) return;
    }

    state.votingOpen = true;
    state.voted = new Set();
    io.emit("state", getFullState());
    io.emit("votingOpened", { category });
  });

  // Presenter: close voting and determine winner of match
  socket.on("closeVoting", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.votingOpen = false;
    const category = state.currentCategory;
    if (state.tieBreak?.active) return;

    if (state.categoryModes[category] === "popular") {
      state.voted = new Set();
      const leaderboard = getCategoryLeaderboard(category);
      if (leaderboard.length > 1 && leaderboard[0].votes === leaderboard[1].votes) {
        const topVotes = leaderboard[0].votes;
        const candidates = leaderboard
          .filter((contestant) => contestant.votes === topVotes)
          .map((contestant) => ({ id: contestant.id, name: contestant.name }));
        createTieBreak(category, candidates, { type: "popular" });
        io.emit("state", getFullState());
        io.emit("tieBreakReady", { category, candidates });
        return;
      }

      state.categoryCompleted[category] = true;
      state.categoryResolvedWinner[category] = leaderboard[0]?.id || null;
      const winner = getCategoryWinner(category);
      io.emit("state", getFullState());
      if (winner) {
        io.emit("matchResult", {
          winner,
          category,
          leaderboard: getCategoryLeaderboard(category),
        });
      }
      return;
    }

    const match = getCurrentMatch(category);
    if (!match) return;

    const aVotes = match.votes[match.a.id] || 0;
    const bVotes = match.votes[match.b.id] || 0;

    if (aVotes === bVotes) {
      state.voted = new Set();
      createTieBreak(category, [
        { id: match.a.id, name: match.a.name },
        { id: match.b.id, name: match.b.name },
      ], { type: "match" });
      io.emit("state", getFullState());
      io.emit("tieBreakReady", { category, candidates: state.tieBreak.candidates });
      return;
    }
    match.winner = aVotes > bVotes ? match.a.id : match.b.id;

    // Move to next match
    state.currentMatch[state.currentCategory]++;
    const bracket = state.brackets[state.currentCategory];
    const round = bracket[state.currentRound[state.currentCategory]];

    if (state.currentMatch[state.currentCategory] >= round.length) {
      // All matches in round done, build next round
      buildNextRound(state.currentCategory);
    }

    state.voted = new Set();
    io.emit("state", getFullState());
    io.emit("matchResult", {
      winner: match.winner === match.a.id ? match.a : match.b,
      match,
    });
  });

  // Presenter: switch category
  socket.on("switchCategory", (category) => {
    if (state.users[socket.id]?.role !== "presenter") return;
    if (state.categories.includes(category)) {
      if (state.tieBreak?.active) return;
      state.votingOpen = false;
      state.currentCategory = category;
      state.voted = new Set();
      io.emit("state", getFullState());
    }
  });

  socket.on("spinTieBreak", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    if (!state.tieBreak?.active || state.tieBreak.spinning) return;

    const winnerCandidate = state.tieBreak.candidates[Math.floor(Math.random() * state.tieBreak.candidates.length)];
    state.tieBreak.spinning = true;
    const duration = 4500;
    io.emit("state", getFullState());
    io.emit("tieBreakStarted", {
      category: state.tieBreak.category,
      candidates: state.tieBreak.candidates,
      winnerId: winnerCandidate.id,
      duration,
    });

    setTimeout(() => {
      let result = null;
      if (state.tieBreak?.context?.type === "popular") {
        result = resolvePopularTieBreak(winnerCandidate.id);
      } else {
        result = resolveTournamentTieBreak(winnerCandidate.id);
      }

      state.voted = new Set();
      io.emit("state", getFullState());
      if (result?.winner) {
        io.emit("matchResult", result);
      }
    }, duration);
  });

  // Presenter: announce winner
  socket.on("announceWinner", ({ name, category }) => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.announcedWinner = { name, category };
    io.emit("state", getFullState());
    io.emit("winnerAnnounced", { name, category });
  });

  // Presenter: clear winner announcement
  socket.on("clearWinner", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.announcedWinner = null;
    io.emit("state", getFullState());
  });

  // Voter: cast vote
  socket.on("vote", ({ contestantId }) => {
    if (!state.votingOpen) return;
    const user = state.users[socket.id];
    if (!user) return;
    const category = state.currentCategory;

    // Contestants can't vote in their own category
    if (user.role === "contestant" && socket.contestantCategory === category) {
      socket.emit("voteError", "No puedes votar en tu propia categoría");
      return;
    }

    // Check if already voted
    if (state.voted.has(socket.id)) {
      socket.emit("voteError", "Ya votaste en esta ronda");
      return;
    }

    if (state.categoryModes[category] === "popular") {
      const contestant = state.contestants[category].find((c) => c.id === contestantId);
      if (!contestant) return;
      state.categoryVotes[category][contestantId] = (state.categoryVotes[category][contestantId] || 0) + 1;
    } else {
      const match = getCurrentMatch(category);
      if (!match) return;
      if (contestantId !== match.a.id && contestantId !== match.b.id) return;
      match.votes[contestantId] = (match.votes[contestantId] || 0) + 1;
    }

    state.voted.add(socket.id);

    io.emit("state", getFullState());
    if (state.categoryModes[category] === "popular") {
      io.emit("voteUpdate", {
        category,
        votes: state.categoryVotes[category],
        totalVotes: Object.values(state.categoryVotes[category]).reduce((a, b) => a + b, 0),
      });
    } else {
      const match = getCurrentMatch(category);
      io.emit("voteUpdate", {
        category,
        votes: match ? match.votes : {},
        totalVotes: match ? Object.values(match.votes).reduce((a, b) => a + b, 0) : 0,
      });
    }
    socket.emit("voteCast", { contestantId });
  });

  // Presenter: reset everything
  socket.on("resetAll", () => {
    if (state.users[socket.id]?.role !== "presenter") return;
    state.contestants = { vestimenta: [], presentacion: [] };
    state.brackets = { vestimenta: [], presentacion: [] };
    state.currentRound = { vestimenta: 0, presentacion: 0 };
    state.currentMatch = { vestimenta: 0, presentacion: 0 };
    state.votingOpen = false;
    state.categoryVotes = { vestimenta: {}, presentacion: {} };
    state.categoryCompleted = { vestimenta: false, presentacion: false };
    state.categoryResolvedWinner = { vestimenta: null, presentacion: null };
    state.voted = new Set();
    state.registrationOpen = true;
    state.announcedWinner = null;
    state.currentCategory = "vestimenta";
    clearTieBreak();
    io.emit("state", getFullState());
    io.emit("resetTriggered");
  });

  socket.on("disconnect", () => {
    delete state.users[socket.id];
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Votatoon running on http://${HOST}:${PORT}`);
});
