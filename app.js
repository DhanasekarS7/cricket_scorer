const menuToggle = document.getElementById("menuToggle");
const mainNav = document.querySelector(".main-nav");
const toast = document.getElementById("toast");
const statusText = document.getElementById("connectionStatus");
const matchCard = document.getElementById("matchCard");
const matchStatusPill = document.getElementById("matchStatusPill");
const supabase = window.supabase?.createClient(window.POWERPLAY_SUPABASE_URL || "", window.POWERPLAY_SUPABASE_KEY || "");
let toastTimer, activeTournament, matchChannel, currentUser, currentRole, staffTeams = [], selectedScoringMatch;

menuToggle.addEventListener("click", () => {
  const opened = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(opened));
});
mainNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  mainNav.classList.remove("open"); menuToggle.setAttribute("aria-expanded", "false");
}));

function showToast(message) {
  toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}
function node(tag, className, value) {
  const el = document.createElement(tag); if (className) el.className = className;
  if (value !== undefined) el.textContent = value; return el;
}
function showNoFixtures(message) {
  document.getElementById("matchHeading").textContent = "Upcoming matches";
  document.getElementById("matchState").textContent = message || "Fixtures appear after teams are confirmed";
  matchStatusPill.classList.remove("live"); matchStatusPill.replaceChildren(node("i"), document.createTextNode(" FIXTURES PENDING"));
  matchCard.classList.add("empty-match");
  const body = matchCard.querySelector(".empty-match-body"); body.className = "empty-match-body"; body.replaceChildren();
  const copy = document.createElement("div"); copy.append(node("h3", "", "Teams are getting ready"));
  copy.append(node("p", "", "Upcoming fixtures will appear here when registrations are confirmed and the organizer publishes the schedule."));
  const metric = document.createElement("div"); metric.className = "match-metric";
  metric.append(node("span", "", "TOURNAMENT"), node("b", "", "Registration in progress"));
  body.append(node("div", "empty-crest", "✦"), copy, metric);
}
function showFixture(match) {
  const live = match.match_status === "live", state = match.state || {};
  const balls = Number(state.legalBalls || 0), overs = Math.floor(balls / 6) + (balls % 6) / 10;
  document.getElementById("matchHeading").textContent = live ? "Live match" : "Upcoming matches";
  document.getElementById("matchState").textContent = live ? "Score updates appear as the scorer records each ball" : "Next scheduled fixture";
  matchStatusPill.classList.toggle("live", live); matchStatusPill.replaceChildren(node("i"), document.createTextNode(live ? " LIVE NOW" : " UPCOMING"));
  matchCard.classList.remove("empty-match"); matchCard.querySelector(".match-number").textContent = match.title || "POWERPLAY ARENA · MATCH DAY";
  const body = matchCard.querySelector(".empty-match-body"); body.className = "empty-match-body fixture-body"; body.replaceChildren();
  const score = document.createElement("div"); score.className = "fixture-score";
  score.append(node("small", "", live ? "LIVE SCORE" : "MATCH"), node("b", "", live ? `${state.score || 0}/${state.wickets || 0}` : "VS"));
  score.append(node("span", "", live ? `${overs.toFixed(1)} overs` : (match.scheduled_at ? new Date(match.scheduled_at).toLocaleString() : "Time to be confirmed")));
  const teams = document.createElement("div"); teams.className = "fixture-teams";
  teams.append(node("strong", "", match.team_a?.name || "Team A"), node("span", "", "vs"), node("strong", "", match.team_b?.name || "Team B"));
  const venue = document.createElement("div"); venue.className = "match-metric"; venue.append(node("span", "", "VENUE"), node("b", "", match.venue || "To be confirmed"));
  body.append(score, teams, venue);
}
async function loadTournament() {
  if (!supabase) { statusText.textContent = "Database connection unavailable"; return; }
  const { data: tournament, error } = await supabase.from("tournaments").select("id,name,status,registration_open,settings").eq("slug", "powerplay-arena").maybeSingle();
  if (error || !tournament) { statusText.textContent = "Waiting for tournament setup"; showNoFixtures(error ? "Could not load tournament data" : "No tournament record yet"); return; }
  activeTournament = tournament;
  const { data: matches, error: matchError } = await supabase.from("matches")
    .select("id,title,match_status,scheduled_at,venue,state,team_a:teams!matches_team_a_id_fkey(name),team_b:teams!matches_team_b_id_fkey(name)")
    .eq("tournament_id", tournament.id).in("match_status", ["live", "upcoming"]).order("scheduled_at", { ascending: true, nullsFirst: false });
  if (matchError) { statusText.textContent = "Could not load fixtures"; showNoFixtures("Fixture data is temporarily unavailable"); return; }
  const visible = matches || [], featured = visible.find((m) => m.match_status === "live") || visible[0];
  featured ? showFixture(featured) : showNoFixtures(tournament.registration_open ? "Waiting for the first fixture" : "Fixtures appear after teams are confirmed");
  statusText.textContent = "Connected to tournament data";
  if (!matchChannel) matchChannel = supabase.channel("tournament-" + tournament.id + "-matches")
    .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: "tournament_id=eq." + tournament.id }, () => { loadTournament(); if (currentRole) loadStaff(); })
    .subscribe();
  updateRegistrationForm();
}
function updateRegistrationForm() {
  const form = document.getElementById("registrationForm"), intro = document.getElementById("registrationIntro");
  form.classList.toggle("hidden", !activeTournament?.registration_open);
  const open = Boolean(activeTournament?.registration_open);
  intro.textContent = open ? "Registration is open. Send your team details for organizer review." : "Registration details are being finalized. The organizer will publish the sign-up steps here when the list opens.";
  document.getElementById("registrationStatus").lastChild.textContent = open ? " Registration open" : " Awaiting organizer update";
}
function requestOrganizerSignIn() {
  const dialog = document.getElementById("signInDialog");
  if (!dialog) return showToast("Sign-in form could not load. Refresh the page and try again.");
  if (currentUser && supabase) {
    supabase.auth.signOut().then(({ error }) => showToast(error ? "Could not sign out: " + error.message : "You have signed out."));
    return;
  }
  const message = document.getElementById("signInMessage");
  message.textContent = supabase ? "" : "Sign-in service connect aagala. Page-a refresh pannitu marubadi try pannunga.";
  document.getElementById("signInEmail").value = "";
  if (!dialog.open) dialog.showModal();
  document.getElementById("signInEmail").focus();
}
async function syncRole(session) {
  currentUser = session?.user || null; currentRole = null;
  const workspace = document.getElementById("staffWorkspace");
  document.getElementById("signInButton").textContent = currentUser?.email ? "Sign out · " + currentUser.email : "Organizer sign in";
  if (!currentUser) { workspace.classList.add("hidden"); return; }
  let { data: role } = await supabase.from("match_admins").select("role").eq("user_id", currentUser.id).maybeSingle();
  if (!role && currentUser.email?.toLowerCase() === "sekard418@gmail.com") {
    await supabase.from("match_admins").insert({ user_id: currentUser.id, role: "owner" });
    ({ data: role } = await supabase.from("match_admins").select("role").eq("user_id", currentUser.id).maybeSingle());
  }
  if (!role) { workspace.classList.add("hidden"); showToast("This account has not been approved for tournament staff."); return; }
  currentRole = role.role; workspace.classList.remove("hidden");
  document.getElementById("staffRole").textContent = role.role.replaceAll("_", " ").toUpperCase();
  const organizer = ["owner", "tournament_admin"].includes(currentRole);
  document.getElementById("registrationAdmin").classList.toggle("hidden", !organizer);
  document.getElementById("fixtureAdmin").classList.toggle("hidden", !organizer);
  await loadStaff();
}
async function loadStaff() {
  if (!currentRole || !activeTournament) return;
  const organizer = ["owner", "tournament_admin"].includes(currentRole);
  document.getElementById("roleManagement").classList.add("hidden");
  document.getElementById("registrationToggle").textContent = activeTournament.registration_open ? "Close registration" : "Open registration";
  if (organizer) {
    fillSettingsForm();
    const rolesPanel = document.getElementById("roleManagement");
    rolesPanel.classList.toggle("hidden", currentRole !== "owner");
    if (currentRole === "owner") {
      const { data: roster, error: rosterError } = await supabase.rpc("get_tournament_staff");
      const host = document.getElementById("staffRoster"); host.replaceChildren();
      if (rosterError) host.append(node("small", "", "Could not load staff list: " + rosterError.message));
      else (roster || []).forEach((member) => {
        const row = document.createElement("div"); row.className = "staff-row";
        row.append(node("b", "", member.email || "Staff account"), node("small", "", member.role.replaceAll("_", " ")));
        host.append(row);
      });
    }
    const { data: applications, error } = await supabase.from("team_registrations").select("id,team_name,captain_name,contact_email,contact_phone,notes,submitted_at,status").eq("tournament_id", activeTournament.id).eq("status", "pending").order("submitted_at", { ascending: true });
    const list = document.getElementById("applicationsList"); list.replaceChildren();
    if (error) list.append(node("small", "", "Unable to load applications: " + error.message));
    else if (!applications?.length) list.append(node("small", "", "No pending applications yet."));
    else applications.forEach((app) => {
      const row = document.createElement("div"); row.className = "staff-row";
      const details = document.createElement("div"); details.append(node("b", "", app.team_name), node("small", "", `${app.captain_name} · ${app.contact_email || app.contact_phone || "No contact"}`));
      if (app.notes) details.append(node("small", "", app.notes));
      const actions = document.createElement("div"); actions.className = "row-actions";
      ["approved", "rejected"].forEach((decision) => { const b = node("button", "mini-button", decision === "approved" ? "Approve" : "Reject"); b.addEventListener("click", () => reviewApplication(app.id, decision)); actions.append(b); });
      row.append(details, actions); list.append(row);
    });
    const { data: teams } = await supabase.from("teams").select("id,name").eq("tournament_id", activeTournament.id).eq("status", "approved").order("name");
    staffTeams = teams || []; populateTeamSelects();
  }
  const { data: matches } = await supabase.from("matches").select("id,title,match_status,state,team_a:teams!matches_team_a_id_fkey(name),team_b:teams!matches_team_b_id_fkey(name)").eq("tournament_id", activeTournament.id).in("match_status", ["upcoming", "live"]).order("scheduled_at", { ascending: true, nullsFirst: false });
  renderStaffMatches(matches || []);
}
function fillSettingsForm() {
  const form = document.getElementById("settingsForm"), settings = activeTournament.settings || {}, extras = settings.extras || {};
  ["playersPerTeam", "oversPerInnings", "wicketsPerInnings", "inningsPerMatch"].forEach((key) => { form.elements[key].value = settings[key] ?? ({ playersPerTeam: 5, oversPerInnings: 4, wicketsPerInnings: 4, inningsPerMatch: 2 }[key]); });
  form.elements.wideEnabled.checked = extras.wideEnabled !== false; form.elements.widePenalty.value = extras.widePenalty ?? 1;
  form.elements.noBallEnabled.checked = extras.noBallEnabled !== false; form.elements.noBallPenalty.value = extras.noBallPenalty ?? 1;
  renderOverRulesEditor();
}
function renderOverRulesEditor() {
  const host = document.getElementById("overRulesEditor"), count = Math.max(1, Math.min(20, Number(document.getElementById("oversPerInnings").value) || 4));
  const existing = activeTournament.settings?.overRules || []; host.replaceChildren(node("div", "eyebrow muted", "OVER BY OVER RULES"));
  for (let i = 0; i < count; i++) {
    const rule = existing[i] || {}, defaults = [
      { name: "Powerplay", allowedChoices: [2,3,4,6] },
      { name: "Double Trouble", allowedChoices: [1,2,3,4,6], doubleRuns: true, pairWicket: true },
      { name: "Bowler’s Challenge", allowedChoices: [3,4,6] },
      { name: "Super Finish", batterChoices: [0,1,2,3,4,5,6], bowlerChoices: [1,2,3,4,5,6] }
    ];
    const d = defaults[i] || { name: `Over ${i + 1}`, batterChoices: [0,1,2,3,4,5,6], bowlerChoices: [1,2,3,4,5,6] };
    const batter = rule.batterChoices || rule.allowedChoices || d.batterChoices || d.allowedChoices;
    const bowler = rule.bowlerChoices || rule.allowedChoices || d.bowlerChoices || d.allowedChoices;
    const row = document.createElement("div"); row.className = "rule-editor-row"; row.dataset.index = String(i);
    const title = node("b", "", `Over ${i + 1}`);
    const name = document.createElement("input"); name.name = `ruleName${i}`; name.value = rule.name || d.name; name.maxLength = 60; name.setAttribute("aria-label", `Over ${i + 1} name`);
    const batterInput = document.createElement("input"); batterInput.name = `batterChoices${i}`; batterInput.value = (batter || []).join(","); batterInput.setAttribute("aria-label", "Batter picks, comma separated");
    const bowlerInput = document.createElement("input"); bowlerInput.name = `bowlerChoices${i}`; bowlerInput.value = (bowler || []).join(","); bowlerInput.setAttribute("aria-label", "Bowler picks, comma separated");
    const doubleLabel = document.createElement("label"), double = document.createElement("input"); double.type = "checkbox"; double.name = `doubleRuns${i}`; double.checked = Boolean(rule.doubleRuns ?? d.doubleRuns); doubleLabel.append(double, document.createTextNode("Double runs"));
    const pairLabel = document.createElement("label"), pair = document.createElement("input"); pair.type = "checkbox"; pair.name = `pairWicket${i}`; pair.checked = Boolean(rule.pairWicket ?? d.pairWicket); pairLabel.append(pair, document.createTextNode("First wicket dismisses pair"));
    row.append(title, name, batterInput, bowlerInput, doubleLabel, pairLabel); host.append(row);
  }
}
function populateTeamSelects() {
  ["team_a", "team_b"].forEach((name) => { const select = document.querySelector(`[name="${name}"]`); select.replaceChildren(new Option("Choose a team", "")); staffTeams.forEach((team) => select.add(new Option(team.name, team.id))); });
}
async function reviewApplication(id, decision) {
  const { error } = await supabase.rpc("review_team_registration", { p_registration_id: id, p_decision: decision });
  showToast(error ? "Could not review application: " + error.message : `Team ${decision}.`); if (!error) loadStaff();
}
function renderStaffMatches(matches) {
  const host = document.getElementById("staffMatches"); host.replaceChildren();
  if (!matches.length) host.append(node("small", "", "No scheduled matches."));
  matches.forEach((match) => {
    const row = document.createElement("div"); row.className = "staff-row";
    const title = match.title || `${match.team_a?.name || "Team A"} vs ${match.team_b?.name || "Team B"}`;
    row.append(node("b", "", title)); const actions = document.createElement("div"); actions.className = "row-actions";
    if (match.match_status === "upcoming" && ["owner", "tournament_admin"].includes(currentRole)) {
      const start = node("button", "mini-button", "Start live"); start.addEventListener("click", () => setMatchStatus(match.id, "live")); actions.append(start);
    }
    if (match.match_status === "live" && ["owner", "tournament_admin", "scorer"].includes(currentRole)) {
      const score = node("button", "mini-button", "Score match"); score.addEventListener("click", () => openScorer(match)); actions.append(score);
    }
    row.append(actions); host.append(row);
  });
}
async function setMatchStatus(id, status) {
  const { error } = await supabase.from("matches").update({ match_status: status }).eq("id", id);
  showToast(error ? "Could not update match: " + error.message : status === "live" ? "Match is live." : "Match updated.");
  if (!error) loadTournament();
}
async function openScorer(match) {
  selectedScoringMatch = match; document.getElementById("scoringWorkspace").classList.remove("hidden");
  document.getElementById("scoringTitle").textContent = match.title || `${match.team_a?.name || "Team A"} vs ${match.team_b?.name || "Team B"}`;
  document.getElementById("scoringWorkspace").scrollIntoView({ behavior: "smooth", block: "center" }); renderScorer();
}
function scoringRules() { return activeTournament?.settings?.overRules || []; }
function renderScorer() {
  if (!selectedScoringMatch) return;
  const state = selectedScoringMatch.state || { innings: 1, score: 0, wickets: 0, legalBalls: 0, pairWicketUsed: false };
  selectedScoringMatch.state = state;
  const over = Math.floor(Number(state.legalBalls || 0) / 6), rule = scoringRules()[over] || { name: "Custom over", batterChoices: [0,1,2,3,4,5,6], bowlerChoices: [1,2,3,4,5,6] };
  const choices = rule.batterChoices || rule.allowedChoices || [0,1,2,3,4,5,6];
  document.getElementById("scoringSummary").textContent = `Innings ${state.innings || 1} · ${state.score || 0}/${state.wickets || 0} · ${Math.floor((state.legalBalls || 0)/6)}.${(state.legalBalls || 0)%6} overs · ${rule.name || "Over"}`;
  const host = document.getElementById("scoringChoices"); host.replaceChildren();
  const bat = document.createElement("div"), bowl = document.createElement("div"); bat.className = bowl.className = "choice-group";
  bat.append(node("small", "", "BATTER PICK")); bowl.append(node("small", "", "BOWLER PICK"));
  choices.forEach((n) => { const b = node("button", "choice-button", String(n)); b.addEventListener("click", () => { host.dataset.batter = String(n); bat.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b)); }); bat.append(b); });
  (rule.bowlerChoices || rule.allowedChoices || [1,2,3,4,5,6]).forEach((n) => { const b = node("button", "choice-button", String(n)); b.addEventListener("click", () => { host.dataset.bowler = String(n); bowl.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b)); }); bowl.append(b); });
  const save = node("button", "button button-lime", "Record ball →"); save.addEventListener("click", () => recordChoice(Number(host.dataset.batter), Number(host.dataset.bowler), rule));
  host.append(bat, bowl, save);
}
async function persistDelivery(event, state) {
  const { error } = await supabase.rpc("record_match_event", { p_match_id: selectedScoringMatch.id, p_event: event, p_state: state });
  if (error) { showToast("Score not saved: " + error.message); return false; }
  selectedScoringMatch.state = state; renderScorer(); loadTournament(); return true;
}
function nextScoreState(addRuns, wicket, legalBall = true, extra = 0) {
  const old = selectedScoringMatch.state || { innings: 1, score: 0, wickets: 0, legalBalls: 0, pairWicketUsed: false };
  const rule = scoringRules()[Math.floor((old.legalBalls || 0) / 6)] || {};
  const pair = wicket && rule.pairWicket && !old.pairWicketUsed;
  const wickets = Math.min(Number(activeTournament.settings?.wicketsPerInnings || 4), (old.wickets || 0) + (wicket ? (pair ? 2 : 1) : 0));
  return { ...old, score: (old.score || 0) + addRuns + extra, wickets, legalBalls: (old.legalBalls || 0) + (legalBall ? 1 : 0), pairWicketUsed: old.pairWicketUsed || Boolean(pair), lastExtra: extra || null };
}
async function recordChoice(batter, bowler, rule) {
  if (!Number.isFinite(batter) || !Number.isFinite(bowler)) return showToast("Choose both batter and bowler numbers first.");
  const wicket = batter === bowler, runs = wicket ? 0 : batter * (rule.doubleRuns ? 2 : 1), state = nextScoreState(runs, wicket);
  await persistDelivery({ kind: "delivery", batter, bowler, runs, wicket, rule: rule.name }, state);
}
async function recordSpecial(kind) {
  if (!selectedScoringMatch) return;
  const config = activeTournament.settings?.extras || {};
  if (kind === "wide" && config.wideEnabled === false) return showToast("Wides are disabled for this tournament.");
  if (kind === "noBall" && config.noBallEnabled === false) return showToast("No-balls are disabled for this tournament.");
  const wicket = kind === "wicket", extra = kind === "wide" ? Number(config.widePenalty || 1) : kind === "noBall" ? Number(config.noBallPenalty || 1) : 0;
  const state = nextScoreState(0, wicket, kind === "wicket", extra);
  await persistDelivery({ kind: "delivery", extraType: kind, runs: extra, wicket }, state);
}
async function undoDelivery() {
  if (!selectedScoringMatch) return;
  const { data, error } = await supabase.rpc("undo_last_match_event", { p_match_id: selectedScoringMatch.id });
  if (error) showToast("Could not undo: " + error.message);
  else { selectedScoringMatch.state = data; renderScorer(); loadTournament(); showToast("Last scoring action undone."); }
}

document.getElementById("registrationForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget), contact = String(form.get("contact")).trim();
  const email = contact.includes("@") ? contact : null, phone = email ? null : contact;
  const { error } = await supabase.from("team_registrations").insert({ tournament_id: activeTournament.id, team_name: form.get("team_name"), captain_name: form.get("captain_name"), contact_email: email, contact_phone: phone, notes: form.get("notes") || null, status: "pending" });
  showToast(error ? "Registration could not be sent: " + error.message : "Application submitted for organizer review."); if (!error) event.currentTarget.reset();
});
document.getElementById("registrationToggle").addEventListener("click", async () => {
  const open = !activeTournament.registration_open;
  const { error } = await supabase.from("tournaments").update({ registration_open: open, status: open ? "registration_open" : "registration_closed" }).eq("id", activeTournament.id);
  if (error) showToast("Could not change registration: " + error.message); else { activeTournament.registration_open = open; updateRegistrationForm(); loadStaff(); showToast(open ? "Team registration is open." : "Team registration is closed."); }
});
document.getElementById("fixtureForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget), a = String(form.get("team_a")), b = String(form.get("team_b"));
  if (a === b) return showToast("Choose two different teams.");
  const { error } = await supabase.from("matches").insert({ id: crypto.randomUUID(), tournament_id: activeTournament.id, team_a_id: a, team_b_id: b, title: form.get("title") || null, scheduled_at: form.get("scheduled_at") ? new Date(form.get("scheduled_at")).toISOString() : null, venue: form.get("venue") || null, match_status: "upcoming", state: { innings: 1, score: 0, wickets: 0, legalBalls: 0, pairWicketUsed: false } });
  showToast(error ? "Could not create fixture: " + error.message : "Fixture saved."); if (!error) { event.currentTarget.reset(); loadStaff(); loadTournament(); }
});
document.getElementById("oversPerInnings").addEventListener("change", renderOverRulesEditor);
document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!activeTournament) return;
  const form = event.currentTarget, integer = (key) => Math.max(0, Number(form.elements[key].value) || 0), count = Math.max(1, Math.min(20, integer("oversPerInnings")));
  if (!form.reportValidity()) return;
  const overRules = Array.from({ length: count }, (_, i) => {
    const picks = (field) => [...new Set(String(form.elements[`${field}${i}`].value).split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9))];
    const batterChoices = picks("batterChoices"), bowlerChoices = picks("bowlerChoices");
    const rule = { over: i + 1, name: form.elements[`ruleName${i}`].value.trim() || `Over ${i + 1}`, batterChoices, bowlerChoices, doubleRuns: form.elements[`doubleRuns${i}`].checked, pairWicket: form.elements[`pairWicket${i}`].checked };
    if (batterChoices.length === bowlerChoices.length && batterChoices.join(",") === bowlerChoices.join(",")) rule.allowedChoices = batterChoices;
    return rule;
  });
  if (overRules.some((r) => !r.batterChoices.length || !r.bowlerChoices.length)) return showToast("Every over needs at least one valid batter and bowler pick.");
  const settings = { ...activeTournament.settings, playersPerTeam: integer("playersPerTeam"), oversPerInnings: count, wicketsPerInnings: integer("wicketsPerInnings"), inningsPerMatch: integer("inningsPerMatch"), overRules, extras: { wideEnabled: form.elements.wideEnabled.checked, widePenalty: integer("widePenalty"), noBallEnabled: form.elements.noBallEnabled.checked, noBallPenalty: integer("noBallPenalty") } };
  const { error } = await supabase.from("tournaments").update({ settings }).eq("id", activeTournament.id);
  if (error) showToast("Could not save tournament setup: " + error.message); else { activeTournament.settings = settings; showToast("Tournament setup saved."); }
});
document.getElementById("staffForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const { error } = await supabase.rpc("approve_tournament_staff", { p_email: form.get("email"), p_role: form.get("role") });
  showToast(error ? "Could not approve staff: " + error.message : "Staff access approved.");
  if (!error) { event.currentTarget.reset(); loadStaff(); }
});
document.getElementById("undoDelivery").addEventListener("click", undoDelivery);
document.querySelectorAll("[data-extra]").forEach((button) => button.addEventListener("click", () => recordSpecial(button.dataset.extra)));
document.getElementById("nextInnings").addEventListener("click", async () => {
  const old = selectedScoringMatch?.state || {}, state = { innings: (old.innings || 1) + 1, score: 0, wickets: 0, legalBalls: 0, pairWicketUsed: false, target: (old.score || 0) + 1 };
  if (old.innings >= Number(activeTournament.settings?.inningsPerMatch || 2)) return showToast("This match has no more innings.");
  await persistDelivery({ kind: "innings_break", state_before: old }, state);
});
document.getElementById("finishMatch").addEventListener("click", async () => {
  if (!selectedScoringMatch) return;
  const { error } = await supabase.from("matches").update({ match_status: "completed" }).eq("id", selectedScoringMatch.id);
  showToast(error ? "Could not finish match: " + error.message : "Match marked complete.");
  if (!error) { document.getElementById("scoringWorkspace").classList.add("hidden"); loadTournament(); loadStaff(); }
});
document.getElementById("signInButton").addEventListener("click", requestOrganizerSignIn);
document.getElementById("closeSignIn").addEventListener("click", () => document.getElementById("signInDialog").close());
document.getElementById("signInForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("sendSignInLink"), message = document.getElementById("signInMessage");
  const email = document.getElementById("signInEmail").value.trim();
  if (!supabase) { message.textContent = "Supabase connect aagala. Please refresh the page and try again."; return; }
  button.disabled = true; message.textContent = "Sign-in link anuppuren…";
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    if (error) { message.textContent = error.message; return; }
    message.textContent = "Link anuppiyachu. Inbox/spam check pannunga.";
  } catch (error) {
    message.textContent = error?.message || "Sign-in request pogala. Page-a refresh pannitu marubadi try pannunga.";
  } finally { button.disabled = false; }
});
document.getElementById("adminButton").addEventListener("click", () => {
  if (currentUser) document.getElementById("staffWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
  else requestOrganizerSignIn();
});
supabase?.auth.onAuthStateChange((_event, session) => { setTimeout(() => syncRole(session), 0); });
loadTournament();
supabase?.auth.getSession().then(({ data }) => syncRole(data.session));
