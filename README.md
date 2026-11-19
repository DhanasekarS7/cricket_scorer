# Powerplay Arena — first website draft

This is the initial reviewable page for the Telegram cricket tournament. It includes the live/upcoming match area, standings, registration status, and the four supplied default over rules. It intentionally uses no sample teams or made-up scores.

## Planned free hosting and database

- Host the static site on Cloudflare Pages Free.
- Keep tournament data, authentication, and live updates in the existing Supabase PostgreSQL project, Powerplay Arena.
- The database is PostgreSQL, not MySQL. You can write SQL in Supabase's browser SQL editor; there is no need to share a database password with Codex.

## Current build status

- The first responsive tournament home page is in place. It shows a live match when one exists, otherwise an upcoming fixture, and avoids presenting sample teams or scores.
- The Supabase tournament schema is installed. It includes tournaments, approved teams, private team-registration details, match scheduling fields, and row-level security.
- Registration is closed by default. Team contact details are visible only to approved tournament staff.
- The home page reads tournament and match data from Supabase and subscribes to changes in the existing live match table.
- The scorer workspace, registration form, standings calculations, settings editor, and role-management screen are still to be built.

Never put a database password, Supabase secret key, or service-role key in website files. A browser publishable key may be used only with correct database policies.
