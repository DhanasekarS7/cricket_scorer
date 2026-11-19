const menuToggle = document.getElementById("menuToggle");
const mainNav = document.querySelector(".main-nav");
const toast = document.getElementById("toast");
const statusText = document.getElementById("connectionStatus");
const matchCard = document.getElementById("matchCard");
const matchStatusPill = document.getElementById("matchStatusPill");
const supabase = window.supabase?.createClient(
  window.POWERPLAY_SUPABASE_URL || "",
  window.POWERPLAY_SUPABASE_KEY || ""
);
let toastTimer;
let activeTournament;
let matchChannel;

menuToggle.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

mainNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function makeText(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function showNoFixtures(message) {
  document.getElementById("matchHeading").textContent = "Upcoming matches";
  document.getElementById("matchState").textContent = message || "Fixtures appear after teams are confirmed";
  matchStatusPill.classList.remove("live");
  matchStatusPill.innerHTML = "<i></i> FIXTURES PENDING";
  matchCard.classList.add("empty-match");
  const body = matchCard.querySelector(".empty-match-body");
  body.className = "empty-match-body";
  body.replaceChildren();
  const crest = makeText("div", "empty-crest", "✦");
  const copy = document.createElement("div");
  copy.append(makeText("h3", "", "Teams are getting ready"));
  copy.append(makeText("p", "", "Upcoming fixtures will appear here when registrations are confirmed and the organizer publishes the schedule."));
  const metric = document.createElement("div");
  metric.className = "match-metric";
  metric.append(makeText("span", "", "TOURNAMENT"));
  metric.append(makeText("b", "", "Registration in progress"));
  body.append(crest, copy, metric);
}

function showFixture(match) {
  const isLive = match.match_status === "live";
  const state = match.state || {};
  const score = Number(state.score ?? 0);
  const wickets = Number(state.wickets ?? 0);
  const balls = Number(state.legalBalls ?? 0);
  const overs = Math.floor(balls / 6) + (balls % 6) / 10;
  const teamA = match.team_a?.name || "Team A";
  const teamB = match.team_b?.name || "Team B";

  document.getElementById("matchHeading").textContent = isLive ? "Live match" : "Upcoming matches";
  document.getElementById("matchState").textContent = isLive ? "Score updates appear as the scorer records each ball" : "Next scheduled fixture";
  matchStatusPill.classList.toggle("live", isLive);
  matchStatusPill.innerHTML = isLive ? "<i></i> LIVE NOW" : "<i></i> UPCOMING";
  matchCard.classList.remove("empty-match");
  matchCard.querySelector(".match-number").textContent = match.title || "POWERPLAY ARENA · MATCH DAY";

  const body = matchCard.querySelector(".empty-match-body");
  body.className = "empty-match-body fixture-body";
  body.replaceChildren();
  const scoreBlock = document.createElement("div");
  scoreBlock.className = "fixture-score";
  scoreBlock.append(makeText("small", "", isLive ? "LIVE SCORE" : "MATCH"));
  scoreBlock.append(makeText("b", "", isLive ? score + "/" + wickets : "VS"));
  scoreBlock.append(makeText("span", "", isLive ? overs.toFixed(1) + " overs" : (match.scheduled_at ? new Date(match.scheduled_at).toLocaleString() : "Time to be confirmed")));

  const teams = document.createElement("div");
  teams.className = "fixture-teams";
  teams.append(makeText("strong", "", teamA));
  teams.append(makeText("span", "", "vs"));
  teams.append(makeText("strong", "", teamB));

  const venue = document.createElement("div");
  venue.className = "match-metric";
  venue.append(makeText("span", "", "VENUE"));
  venue.append(makeText("b", "", match.venue || "To be confirmed"));
  body.append(scoreBlock, teams, venue);
}

async function loadTournament() {
  if (!supabase) {
    statusText.textContent = "Database connection unavailable";
    return;
  }
  statusText.textContent = "Connecting to live score data…";
  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, name, status, registration_open, settings")
    .eq("slug", "powerplay-arena")
    .maybeSingle();

  if (tournamentError || !tournament) {
    statusText.textContent = "Waiting for tournament setup";
    showNoFixtures(tournamentError ? "Could not load tournament data" : "No tournament record yet");
    return;
  }
  activeTournament = tournament;

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, title, match_status, scheduled_at, venue, state, team_a:teams!matches_team_a_id_fkey(name), team_b:teams!matches_team_b_id_fkey(name)")
    .eq("tournament_id", tournament.id)
    .in("match_status", ["live", "upcoming"])
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  if (matchesError) {
    statusText.textContent = "Could not load fixtures";
    showNoFixtures("Fixture data is temporarily unavailable");
    return;
  }
  const upcoming = matches || [];
  const match = upcoming.find((item) => item.match_status === "live") || upcoming[0];
  if (match) showFixture(match);
  else showNoFixtures(tournament.registration_open ? "Waiting for the first fixture" : "Fixtures appear after teams are confirmed");
  statusText.textContent = "Connected to tournament data";

  if (!matchChannel) {
    matchChannel = supabase
      .channel("tournament-" + tournament.id + "-matches")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: "tournament_id=eq." + tournament.id }, loadTournament)
      .subscribe();
  }
}

async function requestOrganizerSignIn() {
  if (!supabase) {
    showToast("The score service is not connected yet.");
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.auth.signOut();
    showToast("You have signed out.");
    return;
  }
  const email = window.prompt("Enter your approved organizer email address.");
  if (!email) return;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.href }
  });
  showToast(error ? "Sign-in could not start: " + error.message : "Check your email for the secure sign-in link.");
}

document.getElementById("signInButton").addEventListener("click", requestOrganizerSignIn);
document.getElementById("adminButton").addEventListener("click", requestOrganizerSignIn);
supabase?.auth.onAuthStateChange((_event, session) => {
  document.getElementById("signInButton").textContent = session?.user?.email
    ? session.user.email + " · Sign out"
    : "Organizer sign in";
});

loadTournament();
