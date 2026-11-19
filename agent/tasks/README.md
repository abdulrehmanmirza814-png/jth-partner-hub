# Tasks

Each `.md` file here is one job for the assistant. Write the instructions in plain English.
The block between the `---` lines is optional settings.

    ---
    name: my-task                 # unique short name
    schedule: manual              # manual | every 6h | every 30m | daily 10:00
    start_url: https://example.com/
    allowed_domains: example.com  # the assistant cannot leave these sites
    max_steps: 60                 # safety limit on actions per run
    max_minutes: 30
    max_publishes_per_run: 5      # most public comments/posts/messages per run
    max_publishes_per_day: 10     # most per day (counted across runs)
    approval: ask                 # ask = you confirm every public post | auto = it posts alone
    vision: true                  # let it also see screenshots (better on busy sites, costs more)
    ---
    Plain-English instructions here...

Run one by hand (a browser window opens and you can watch):

    npm run task -- my-task --dry     # shows what it WOULD post, posts nothing
    npm run task -- my-task           # asks you before each public post
    npm run task -- my-task --auto    # posts by itself, within the limits above

Tasks with a `schedule` other than `manual` run automatically while `npm start` is running,
and then only post if `approval: auto` is set. Otherwise the proposed text is saved to `data/proposed-posts.md`.

Files starting with `_` are ignored (use `_` to switch a task off).
