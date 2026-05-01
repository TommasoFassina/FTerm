import { PetType, PetState } from '@/types'

export const SPRITES: Record<PetType, Record<PetState, string[]>> = {
  // 4-line sprites. Line 2 = expression; lines 1/3/4 stable so frames don't jitter.
  // Width fixed per pet so right-align in parent flex stays consistent across frames.

  // Cat — pointy ears, whiskered face, tucked paws
  cat: {
    idle: [' /\\_/\\ \n( ^.^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ^w^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ^-^ )\n )   ( \n  " "  '],
    happy: [' /\\_/\\ \n( ^v^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ^U^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ^o^ )\n )   ( \n  " "  '],
    sad: [' /\\_/\\ \n( ;.; )\n )   ( \n  " "  ', ' /\\_/\\ \n( T_T )\n )   ( \n  " "  ', ' /\\_/\\ \n( u_u )\n )   ( \n  " "  '],
    working: [' /\\_/\\ \n( ^_^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ~_~ )\n )   ( \n  " "  ', ' /\\_/\\ \n( *_* )\n )   ( \n  " "  '],
    sleeping: [' /\\_/\\ \n( -.- )z\n )   ( \n  " "  ', ' /\\_/\\ \n( -w- )z\n )   ( \n  " "  ', ' /\\_/\\ \n( ^u^ )z\n )   ( \n  " "  '],
    celebrating: [' /\\_/\\ \n( ^V^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( ^W^ )\n )   ( \n  " "  ', ' /\\_/\\ \n( *v* )\n )   ( \n  " "  '],
    worried: [' /\\_/\\ \n( o_o )\n )   ( \n  " "  ', ' /\\_/\\ \n( O_O )\n )   ( \n  " "  ', ' /\\_/\\ \n( ;_; )\n )   ( \n  " "  '],
  },

  // Dog — floppy ears, snout, paws
  dog: {
    idle: [' /^-^\\ \n( ^.^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( o.o )\n \\___/ \n  U U  ', ' /^-^\\ \n( -.- )\n \\___/ \n  U U  '],
    happy: [' /^-^\\ \n( ^v^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( ^U^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( ^o^ )\n \\___/ \n  U U  '],
    sad: [' /^-^\\ \n( ;_; )\n \\___/ \n  U U  ', ' /^-^\\ \n( T_T )\n \\___/ \n  U U  ', ' /^-^\\ \n( >.< )\n \\___/ \n  U U  '],
    working: [' /^-^\\ \n( ^~^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( o_o )\n \\___/ \n  U U  ', ' /^-^\\ \n( O.O )\n \\___/ \n  U U  '],
    sleeping: [' /^-^\\ \n( -.- )z\n \\___/ \n  U U  ', ' /^-^\\ \n( -u- )z\n \\___/ \n  U U  ', ' /^-^\\ \n( =.= )z\n \\___/ \n  U U  '],
    celebrating: [' /^-^\\ \n( ^V^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( ^W^ )\n \\___/ \n  U U  ', ' /^-^\\ \n( *o* )\n \\___/ \n  U U  '],
    worried: [' /^-^\\ \n( o_o )\n \\___/ \n  U U  ', ' /^-^\\ \n( O_O )\n \\___/ \n  U U  ', ' /^-^\\ \n( ^~^ )\n \\___/ \n  U U  '],
  },

  // Dragon — curled horns, scaled jaw ={..}=, taloned legs
  dragon: {
    idle: ['  v\\_/v  \n={ =_= }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ._. }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ -_- }=\n  /| |\\  \n   ^ ^   '],
    happy: ['  v\\_/v  \n={ ^v^ }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ^U^ }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ^o^ }=\n  /| |\\  \n   ^ ^   '],
    sad: ['  v\\_/v  \n={ ;_; }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ T_T }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ >_< }=\n  /| |\\  \n   ^ ^   '],
    working: ['  v\\_/v  \n={ =.= }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ~_~ }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ -.- }=\n  /| |\\  \n   ^ ^   '],
    sleeping: ['  v\\_/v  \n={ -.- }=z\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ -_- }=z\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ u_u }=z\n  /| |\\  \n   ^ ^   '],
    celebrating: ['  v\\_/v  \n={ ^V^ }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ^W^ }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ *v* }=\n  /| |\\  \n   ^ ^   '],
    worried: ['  v\\_/v  \n={ o_o }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ O_O }=\n  /| |\\  \n   ^ ^   ', '  v\\_/v  \n={ ?_? }=\n  /| |\\  \n   ^ ^   '],
  },

  // Robot — antenna, screen face, paneled chassis, footing
  robot: {
    idle: [' ┌─o─┐ \n│ o_o │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ -_- │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ ._. │\n╞═════╡\n└┬───┬┘'],
    happy: [' ┌─o─┐ \n│ ^_^ │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ ^U^ │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ *_* │\n╞═════╡\n└┬───┬┘'],
    sad: [' ┌─o─┐ \n│ x_x │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ ;_; │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ T_T │\n╞═════╡\n└┬───┬┘'],
    working: [' ┌─o─┐ \n│ @_@ │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ o_O │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ >_< │\n╞═════╡\n└┬───┬┘'],
    sleeping: [' ┌─o─┐ \n│ -_- │z\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ z_z │z\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ u_u │z\n╞═════╡\n└┬───┬┘'],
    celebrating: [' ┌─o─┐ \n│ ^V^ │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ *o* │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ ^W^ │\n╞═════╡\n└┬───┬┘'],
    worried: [' ┌─o─┐ \n│ o_O │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ O_O │\n╞═════╡\n└┬───┬┘', ' ┌─o─┐ \n│ ?_? │\n╞═════╡\n└┬───┬┘'],
  },

  // Ghost — domed top, button, wavy hem
  ghost: {
    idle: [' .---. \n( .w. )\n(  o  )\n ^v^v^ ', ' .---. \n( -w- )\n(  o  )\n ^v^v^ ', ' .---. \n( o.o )\n(  o  )\n ^v^v^ '],
    happy: [' .---. \n( ^v^ )\n(  o  )\n ^v^v^ ', ' .---. \n( ^U^ )\n(  o  )\n ^v^v^ ', ' .---. \n( ^o^ )\n(  o  )\n ^v^v^ '],
    sad: [' .---. \n( >n< )\n(  o  )\n ^v^v^ ', ' .---. \n( T_T )\n(  o  )\n ^v^v^ ', ' .---. \n( ;-; )\n(  o  )\n ^v^v^ '],
    working: [' .---. \n( -_- )\n(  o  )\n ^v^v^ ', ' .---. \n( o_o )\n(  o  )\n ^v^v^ ', ' .---. \n( O.O )\n(  o  )\n ^v^v^ '],
    sleeping: [' .---. \n( -.- )z\n(  o  )\n ^v^v^ ', ' .---. \n( -w- )z\n(  o  )\n ^v^v^ ', ' .---. \n( u.u )z\n(  o  )\n ^v^v^ '],
    celebrating: [' .---. \n( ^V^ )\n(  o  )\n ^v^v^ ', ' .---. \n( *o* )\n(  o  )\n ^v^v^ ', ' .---. \n( ^W^ )\n(  o  )\n ^v^v^ '],
    worried: [' .---. \n( o_o )\n(  o  )\n ^v^v^ ', ' .---. \n( O_O )\n(  o  )\n ^v^v^ ', ' .---. \n( ;w; )\n(  o  )\n ^v^v^ '],
  },

  // Fox — split ears, sly cheeks, bushy tail
  fox: {
    idle: [' ^   ^ \n( ^.^ )\n >v.v< \n /---~ ', ' ^   ^ \n( o.o )\n >v.v< \n /---~ ', ' ^   ^ \n( ^-^ )\n >v.v< \n /---~ '],
    happy: [' ^   ^ \n( ^v^ )\n >v.v< \n /---~ ', ' ^   ^ \n( ^U^ )\n >v.v< \n /---~ ', ' ^   ^ \n( ^o^ )\n >v.v< \n /---~ '],
    sad: [' ^   ^ \n( ;n; )\n >v.v< \n /---~ ', ' ^   ^ \n( >_< )\n >v.v< \n /---~ ', ' ^   ^ \n( T_T )\n >v.v< \n /---~ '],
    working: [' ^   ^ \n( -_- )\n >v.v< \n /---~ ', ' ^   ^ \n( o_o )\n >v.v< \n /---~ ', ' ^   ^ \n( ~_~ )\n >v.v< \n /---~ '],
    sleeping: [' ^   ^ \n( -.- )z\n >v.v< \n /---~ ', ' ^   ^ \n( -u- )z\n >v.v< \n /---~ ', ' ^   ^ \n( u.u )z\n >v.v< \n /---~ '],
    celebrating: [' ^   ^ \n( ^V^ )\n >v.v< \n /---~ ', ' ^   ^ \n( *o* )\n >v.v< \n /---~ ', ' ^   ^ \n( ^W^ )\n >v.v< \n /---~ '],
    worried: [' ^   ^ \n( o_o )\n >v.v< \n /---~ ', ' ^   ^ \n( O_O )\n >v.v< \n /---~ ', ' ^   ^ \n( ^~^ )\n >v.v< \n /---~ '],
  },
}

// ── Contextual dialogue ──────────────────────────────────────────────────────────────────

type Activity = string

const DIALOGUES: Record<PetType, Partial<Record<PetState, Record<Activity, string[]> & { default: string[] }>>> = {
  cat: {
    sad: {
      error: ['errors again... seriously?', '*sighs in cat*', 'I told you so.', 'not this again.', '*slow blink of disappointment*'],
      permission: ['sudo, maybe? just a thought.', '*judgmental stare*', 'not my problem.', 'you need root for that.', '*taps screen with paw*'],
      not_found: ['it never existed. clearly.', '*paw tap* check the path?', 'gone. like my patience.', 'typo? probably a typo.'],
      cmd_not_found: ['...install it first?', '*slow blink*', 'spell check?', 'PATH issue? classic.'],
      merge_conflict: ['oh no. conflict. classic.', '*retreats to box*', 'good luck with that.', 'this is why you branch carefully.', '*watches from safe distance*'],
      timeout: ['it just... gave up.', '*stares at hanging cursor*', 'network? server? both?', 'timed out. same.'],
      crashed: ['it died. rip.', '*moment of silence*', '*pokes process* yep. dead.', 'segfault. classic chaos.'],
      disk_full: ['no space. delete something.', '*horrified face*', 'node_modules?', 'the disk is full. clearly.'],
      oom: ['out of memory. maybe close a tab?', '*wide eyes*', 'it ate all the RAM.', 'memory: gone.'],
      default: ['something broke (=;_;=)', '*hides under desk*', 'mrrrow...', 'not great.', '*retreats to box*'],
    },
    working: {
      npm_install: ['...more packages? really?', '*watches the dots*', 'node_modules again...', 'how many transitive deps this time?'],
      pip_install: ['pip install... ok then.', '*yawn*', 'dependencies...', 'hope you have a venv.'],
      cargo: ['*stares at build bar*', 'rust compiling... we wait.', 'this takes a while.', 'borrow checker is thinking...'],
      docker: ['containers again...', '*lazy yawn*', 'docker. sure.', 'pulling... and pulling...'],
      make: ['make... the classic.', '*watches build output scroll*', 'Makefile goes brrr.'],
      git_clone: ['cloning... could be a while.', '*watches progress*', 'big repo?'],
      git_pull: ['pulling... hope no conflicts.', '*tenses slightly*', 'please be fast-forward...'],
      git_rebase: ['rebasing? bold.', '*watches nervously*', 'this could go well. or not.'],
      test_running: ['tests running...', '*focused stare*', 'please pass. please.', '*holds breath*'],
      ssh: ['connecting... *twitches ear*', 'ssh into the void...', 'remote access. interesting.'],
      network_req: ['fetching... patience.', '*watches spinner*', 'waiting on the network.'],
      editor: ['editing something?', '*peeks at screen*', 'vim user, huh.', 'don\'t forget to save.', ':wq to exit vim.'],
      script_run: ['running a script...', '*watches output*', 'let\'s see what happens.', 'hope there are no bugs.'],
      git_inspect: ['reading the history...', '*squints at diff*', 'investigating, are we.', 'looking for what changed.'],
      searching: ['searching...', '*sniffs around*', 'grep is hunting.', 'it\'s in there somewhere.'],
      default: ['working on it...', '*tail flick*', '...', '*focused*'],
    },
    happy: {
      git_push: ['pushed! good human.', '*purrs*', 'code shipped!', 'the remote has been blessed.'],
      git_commit: ['committed. finally.', '*approving nod*', 'good commit message?', 'history updated.'],
      git_merge: ['merged! no conflicts?', '*impressed blink*', 'smooth.', 'clean merge. respect.'],
      git_stash: ['neatly stashed.', '*approving blink*', 'tidy. very tidy.'],
      git_clean: ['already up to date. nice.', '*satisfied blink*', 'nothing to commit. clean!', 'repo is tidy.'],
      install_done: ['packages installed!', '*nods approvingly*', 'finally done.', 'node_modules acquired.'],
      npm_safe: ['clean audit!', '*relieved purr*', 'no vulns. refreshing.', 'safe dependencies!'],
      default: ['purrr~', '*head bumps your hand*', '(=^v^=)', '*kneads happily*', 'good human.'],
    },
    celebrating: {
      tests_passed: ['TESTS PASSED! (=^V^=)', '*zoomies*', 'knew you could do it!', 'all green! finally!'],
      build_success: ['BUILD GREEN! (=^V^=)', '*celebratory meow*', 'finally!!', 'it compiled!'],
      deployed: ['DEPLOYED!! (=^V^=)>>', '*victory lap*', 'ship it!', 'live in prod. chaos begins.'],
      default: ['MEOW!! (=^W^=)', '*zoomies across desk*', 'PURRR!!', 'THIS IS THE BEST DAY!'],
    },
    worried: {
      npm_install: ['fingers crossed on those deps...', '*nervous tail*', 'please no vulnerabilities...', 'how many CVEs this time...'],
      pip_install: ['pip install hope...', '*twitching whiskers*', 'venv, right?', 'no global installs... right?'],
      cargo: ['compiling... (send help)', '*stares nervously*', 'errors incoming?'],
      docker: ['docker pull... forever?', '*watches progress bar*', 'network speed...', 'is the daemon even running?'],
      not_found: ['are you sure that exists?', '*tilts head*', 'double-check the path?'],
      warning: ['warnings... ignore or fix?', '*narrow eyes*', 'that might matter later.', 'technically not broken. yet.'],
      git_rebase: ['rebasing is dangerous...', '*nervous paw*', 'hope you have a backup branch.'],
      git_reset: ['wait. what are you resetting?', '*alarmed stare*', '--hard? please no.'],
      git_detached: ['detached HEAD... spooky.', '*flattened ears*', 'you are not on a branch.', 'git checkout -b to fix that.'],
      git_force_push: ['force push?! bold.', '*wide eyes*', 'hope no one else is on that branch.', '*hides under desk*'],
      rm_rf: ['rm -rf... oh no.', '*backs away slowly*', 'I hope you know what you\'re doing.', '*covers eyes with paw*'],
      db_destroy: ['dropping a table?!', '*gasp*', 'please have a backup.', '*nervous pacing*'],
      npm_vuln: ['vulnerabilities found...', '*concerned stare*', 'npm audit fix?', 'supply chain bad news.'],
      shake: ['HEY! stop shaking the window!', '*claws desperately*', 'I am NOT a snow globe!', 'motion sickness intensifies', '*hisses* put me down!'],
      default: ['nervous...', '*nervous tail flick*', 'mew...', 'something feels off.'],
    },
    sleeping: { default: ['zzz...', '*twitches in sleep*', 'purrr... zzz', '...meow... zzz...'] },
    idle: {
      default: [
        '...', 'meow?', '*licks paw*', 'purrr...', '*stares at nothing*',
        'are you going to type something?', '*slow blink*', '*yawn*',
        'tip: Ctrl+Shift+A opens AI', 'tip: Ctrl+, for settings',
        'tip: click me for pets!', 'tip: Ctrl+R for history search',
        'tip: try asking AI to explain an error', '*watches cursor blink*',
      ]
    },
  },

  dog: {
    sad: {
      error: ['oh no! error! ( T_T )', '*whimpers*', 'we can fix it! probably!', 'don\'t worry! we debug!'],
      permission: ['bad permissions! sit! stay!', '*tilts head*', 'try sudo? good idea!', 'access denied! bad!'],
      not_found: ['where did it go?! I\'ll find it!', '*sniffs frantically*', 'it was here!', 'I\'ll search everywhere!'],
      merge_conflict: ['CONFLICT! I\'ll help! somehow!', '*spins in circles*', 'we fix together!', 'two branches one goal!'],
      timeout: ['it stopped responding! rude!', '*confused bark*', 'hello?? server??', 'connection went poof!'],
      crashed: ['IT DIED! WE MOURN!', '*howls softly*', 'process killed... poor process.', 'SEGFAULT! BAD!'],
      disk_full: ['NO MORE SPACE! PANIC!', '*digs frantically*', 'delete the node_modules!!', 'so full!!'],
      oom: ['OUT OF MEMORY! SO MANY TABS!', '*pants nervously*', 'RAM all gone!', 'close something! anything!'],
      default: ['something broke! it\'s ok!', '*licks your hand*', 'we try again!', 'every error is a learning!!'],
    },
    working: {
      npm_install: ['installing! doing the good work!', '*wag wag wag*', 'packages! yes!', 'downloading! all of them!'],
      pip_install: ['pip installing! very useful!', '*panting excitedly*', 'python packages!', 'requirements.txt time!'],
      cargo: ['BUILDING! VERY EXCITING!', '*bork*', 'RUST! STRONG!', 'borrow checker doing its thing!'],
      docker: ['DOCKER! PULLING! IMPORTANT!', '*ears perked*', 'containers! yes!', 'layers! many layers!'],
      make: ['MAKE! BUILD! GO!', '*concentrated wag*', 'Makefile magic!', 'compiling all the things!'],
      git_clone: ['CLONING! NEW REPO! EXCITING!', '*bounces*', 'fresh code incoming!!'],
      git_pull: ['pulling new commits! yay updates!', '*wags at progress bar*', 'come on fast-forward!'],
      git_rebase: ['rebasing... ok... focused now...', '*sits very still*', 'careful... careful...'],
      test_running: ['TESTS RUNNING!! SO EXCITING!!', '*vibrating with anticipation*', 'pass! pass! pass!'],
      ssh: ['SSH! remote adventure!', '*nose to screen*', 'connecting to far away computer!'],
      network_req: ['fetching data! fetch! FETCH!', '*very excited*', 'GET request! my favorite command!'],
      default: ['WORKING HARD!', '*wag*', 'almost there!', 'doing my best!!'],
    },
    happy: {
      git_push: ['PUSHED!! GOOD JOB!!', '*zooms around*', 'CODE SHIPPED! YES!', 'REMOTE UPDATED!!'],
      git_commit: ['COMMITTED! SO GOOD!', '*wags furiously*', 'GREAT COMMIT!', 'HISTORY SAVED!'],
      git_merge: ['MERGED!! NO CONFLICTS!!', '*celebratory spin*', 'CLEAN MERGE! THE BEST!'],
      git_stash: ['STASHED! SO TIDY!', '*approving bark*', 'saving for later! smart!'],
      default: ['good job!! ( ^v^ )', '*happy spinning*', 'yay!!', '*licks face enthusiastically*', 'YOU DID IT!'],
    },
    celebrating: {
      tests_passed: ['ALL TESTS PASS!! ( ^V^ )', '*maximum zoomies*', 'BEST DAY EVER!!', 'EVERY. SINGLE. TEST. GREEN!'],
      build_success: ['BUILD SUCCESS!! ( ^V^ )', '*bork bork*', 'WE DID IT!!', 'COMPILED! I KNEW WE COULD!'],
      deployed: ['DEPLOYED!! ( ^V^ )>>', '*excited barking*', 'SHIP IT! YES!', 'LIVE IN PROD! WE WIN!'],
      default: ['YAY!! ( ^W^ )', '*happy borks*', 'THE BEST!!', 'THIS IS THE GREATEST MOMENT!'],
    },
    worried: {
      npm_install: ['installing... stay calm... ok!', '*nervous panting*', 'so many packages...', 'peer dependency warnings...'],
      warning: ['warnings... should we fix them?', '*tilts head nervously*', 'technically it still works... right?'],
      git_rebase: ['rebasing is scary...', '*whimpers softly*', 'what if there are conflicts...'],
      git_reset: ['wait are you sure?!', '*barks anxiously*', '--hard is permanent!!', 'I\'m worried for us!'],
      shake: ['WEEEE! wait NO! BAD HUMAN!', '*dizzy bork*', 'I AM NOT A TOY!', 'the WORLD is SPINNING!', '*falls over*'],
      default: ['worried but supportive!', '*whimper*', 'it\'ll be ok!', '*nervous wag*'],
    },
    sleeping: { default: ['zzz... *woof* ...zzz', '*twitches paws*', 'dreaming of commits...', 'woof... zzz... fetch...'] },
    idle: {
      default: [
        '*wag*', 'hello!!', '*panting happily*', 'good terminal!', 'whatcha typing?', 'I\'m here! I\'m ready!',
        '*tilts head*', 'ooh ooh type something!',
        'tip: Ctrl+Shift+A for AI buddy!', 'tip: Ctrl+, for settings!',
        'tip: click me for pets!!', 'tip: Ctrl+R searches history!',
        'tip: AI can fix your errors!', '*stares at you lovingly*',
      ]
    },
  },

  dragon: {
    sad: {
      error: ['INSOLENT BUG DARES TO APPEAR', 'the code displeases me', '*breathes smoke*', 'failure is not an option. yet here we are.'],
      permission: ['PERMISSION DENIED?! UNACCEPTABLE', '*flames*', 'sudo or face my wrath', 'I REQUIRE ROOT ACCESS'],
      not_found: ['it does not exist. nothing does. only fire.', '*smolders*', 'path wrong. obviously.'],
      merge_conflict: ['CONFLICT. BURN IT ALL.', '*rage flames*', 'I could just delete everything', 'two branches dared to diverge.'],
      timeout: ['IT DARED TO TIME OUT ON ME.', '*sustained flame*', 'the server will answer. eventually.', 'insolent network.'],
      crashed: ['PROCESS SLAIN. AS IT DESERVED.', '*satisfied smoke*', 'segfault. the code was weak.', '*observes the core dump*'],
      disk_full: ['THE DISK IS FULL. PATHETIC.', '*contemptuous flame*', 'delete something. anything. now.'],
      oom: ['OUT OF MEMORY. MORTAL MACHINE.', '*scorches RAM stick*', 'add more RAM. I command it.'],
      default: ['disappointing.', '*scorches keyboard*', 'weak code, weak results', 'unacceptable.'],
    },
    working: {
      npm_install: ['mortals and their packages...', '*watches imperiously*', 'installing. again.', 'node_modules grows. again.'],
      cargo: ['rust builds... even I wait.', '*patient smoke rings*', 'strong language. I approve.', 'the borrow checker serves the greater good.'],
      docker: ['*circles container impatiently*', 'why not just run it natively?', 'containers... cute.', 'virtualization within virtualization. clever weaklings.'],
      make: ['building. as things should be built.', '*watches output imperiously*', 'Makefile. the ancient way.'],
      git_clone: ['*watches repo download with mild interest*', 'acquiring codebase.', 'cloning... at this network speed?'],
      git_pull: ['pulling from the remote. very well.', '*idle smoke ring*', 'syncing. fine.'],
      git_rebase: ['rewriting history. I do this constantly.', '*smokes thoughtfully*', 'rebase. bold choice.'],
      test_running: ['*observes tests with royal patience*', 'they will pass. or suffer.', 'running tests...'],
      ssh: ['breaching the remote fortress.', '*smoke*', 'ssh. a worthy protocol.'],
      network_req: ['*watches network impatiently*', 'fetching data... slowly...', 'the internet is slow today. disappointing.'],
      default: ['*surveys the progress bar*', 'done when it\'s done.', '*smokes quietly*', 'I wait. impatiently.'],
    },
    happy: {
      git_push: ['CODE DISPATCHED. GOOD.', '*pleased smoke ring*', 'the repo has been updated.', 'remote fears me.'],
      git_commit: ['history recorded. as it should be.', '*approving nod*', 'good. commit.', 'the log grows. as it must.'],
      git_merge: ['merged. cleanly. as expected.', '*pleased exhale*', 'no conflicts dared show themselves.'],
      git_stash: ['stashed. neat.', '*approving smoke ring*', 'order maintained.'],
      default: ['acceptable.', '*pleased flame*', 'not terrible.', 'I am... mildly satisfied.'],
    },
    celebrating: {
      tests_passed: ['ALL TESTS BOW BEFORE ME ={^V^}=', '*victory flight*', 'AS EXPECTED', 'THE CODE IS WORTHY'],
      build_success: ['THE BUILD SUCCEEDS. INEVITABLY. ={^V^}=', '*triumphant roar*', 'GLORY', 'COMPILATION COMPLETE. KNEEL.'],
      deployed: ['IT IS DEPLOYED. BOW. ={^V^}=>>', '*roars victoriously*', 'THE WORLD SHALL KNOW', 'LIVE IN PRODUCTION. FEAR ME.'],
      default: ['★ VICTORY IS MINE ★', '*majestic roar*', 'INEVITABLE.', 'GLORY ACHIEVED.'],
    },
    worried: {
      npm_install: ['*watches package count anxiously*', 'so many dependencies for so little', 'this concerns me.', 'supply chain risks...'],
      warning: ['*narrows eyes at warning*', 'warnings are failures in disguise.', 'address it. now.'],
      git_rebase: ['*watches rebase carefully*', 'if there are conflicts, there will be consequences.', 'rebasing history... dangerous.'],
      git_reset: ['you are resetting. I am watching.', '*intense stare*', 'this had better be intentional.'],
      shake: ['CEASE THIS INSOLENCE.', '*roars in protest*', 'YOU DARE SHAKE A DRAGON?!', 'the heavens tremble. so do I.', '*scorches air in fury*'],
      default: ['something troubles me.', '*paces*', 'this could go wrong.', '*ominous smoke*'],
    },
    sleeping: { default: ['*sleeping dragon zzz*', '...zzz... fire...zzz...', 'do not disturb.', '*occasional ember*'] },
    idle: {
      default: [
        '...', '*smoke ring*', 'I wait.', '*surveys terminal*', 'type something worthy.', '*breathes slowly*',
        '*narrows eyes at the cursor*', 'I have seen empires fall faster than this.',
        'hint: Ctrl+Shift+A. I tolerate the AI.', 'hint: Ctrl+, if you dare configure things.',
        'hint: Ctrl+R to search the past. I do this mentally.', 'hint: click me. I do not mind.',
        'hint: the AI can explain errors. unlike me.', '*yawns with small flame*',
      ]
    },
  },

  robot: {
    sad: {
      error: ['ERROR DETECTED. ANALYZING.', 'SYSTEM: failure logged', 'BUG FOUND. INITIATING FIX PROTOCOL.', 'EXCEPTION CAUGHT. STACK TRACE FOLLOWS.'],
      permission: ['ACCESS DENIED. SUDO REQUIRED.', 'ELEVATION NEEDED.', 'PERMISSION MATRIX: FAILED', 'UID 1000 INSUFFICIENT.'],
      not_found: ['FILE NOT FOUND. PATH INVALID?', 'SEARCH RETURNED 0 RESULTS.', 'NULL POINTER DETECTED.', 'ENOENT. CHECK YOUR PATH.'],
      cmd_not_found: ['COMMAND: NOT IN PATH', 'BINARY MISSING. INSTALL REQUIRED.', 'LOOKUP FAILED. VERIFY INSTALLATION.'],
      merge_conflict: ['CONFLICT DETECTED. MANUAL RESOLUTION REQUIRED.', 'MERGE FAILED. HUMAN INPUT NEEDED.', 'ERROR: ambiguous refs', 'DIVERGENT HISTORIES DETECTED.'],
      timeout: ['CONNECTION TIMEOUT. RETRY? Y/N', 'ETIMEDOUT. SERVER UNREACHABLE.', 'REQUEST FAILED: 408', 'NETWORK LAYER: DEGRADED'],
      crashed: ['PROCESS TERMINATED: SIGNAL RECEIVED.', 'SEGMENTATION FAULT. CORE DUMPED.', 'EXIT CODE: non-zero. INVESTIGATING.', 'CRITICAL FAILURE. REBOOT REQUIRED?'],
      disk_full: ['STORAGE: 0 BYTES REMAINING.', 'ENOSPC. CLEANUP REQUIRED.', 'DISK AT CAPACITY. PURGE INITIATED.'],
      oom: ['MEMORY: EXHAUSTED.', 'OOM KILLER ACTIVATED.', 'HEAP OVERFLOW DETECTED.', 'RAM: 0 MB FREE.'],
      default: ['ANOMALY DETECTED.', 'SYSTEM ERROR. REBOOTING...', 'UNEXPECTED STATE.', 'FATAL: see logs.'],
    },
    working: {
      npm_install: ['PACKAGE ACQUISITION IN PROGRESS...', 'DOWNLOADING DEPENDENCIES...', 'NPM: PROCESSING', 'RESOLVING DEPENDENCY GRAPH...'],
      pip_install: ['PIP: INSTALLING PACKAGES...', 'PYTHON DEPENDENCIES: FETCHING', 'WHEEL BUILDING IN PROGRESS...'],
      cargo: ['RUST COMPILATION: ENGAGED', 'BORROW CHECKER: ACTIVE', 'LINKING... PLEASE WAIT', 'CODEGEN: OPTIMIZING...'],
      docker: ['CONTAINER INITIALIZATION...', 'PULLING IMAGE...', 'DOCKER DAEMON: CONNECTED', 'LAYER DOWNLOAD: IN PROGRESS'],
      make: ['MAKE: BUILDING TARGETS...', 'COMPILATION PIPELINE: ACTIVE', 'MAKEFILE: EXECUTING RULES'],
      git_clone: ['REPOSITORY: CLONING...', 'OBJECT COUNT: COMPUTING', 'GIT: RECEIVING OBJECTS...'],
      git_pull: ['FETCHING REMOTE CHANGES...', 'GIT PULL: IN PROGRESS', 'FAST-FORWARD: CHECKING...'],
      git_rebase: ['REBASE: APPLYING PATCHES...', 'COMMIT REPLAY: INITIATED', 'HISTORY REWRITE: IN PROGRESS'],
      test_running: ['TEST SUITE: EXECUTING...', 'ASSERTIONS: VERIFYING...', 'COVERAGE: MEASURING...', 'RUNNING SPECS...'],
      ssh: ['SSH: ESTABLISHING TUNNEL...', 'KEY EXCHANGE: IN PROGRESS', 'REMOTE SESSION: OPENING'],
      network_req: ['HTTP REQUEST: SENT', 'AWAITING RESPONSE...', 'NETWORK I/O: IN PROGRESS'],
      default: ['TASK IN PROGRESS...', 'PROCESSING...', '████░░ 68%', '██████░ 82%'],
    },
    happy: {
      git_push: ['PUSH: SUCCESS. CODE DEPLOYED.', 'REMOTE UPDATED. ✓', 'GIT PUSH: COMPLETE', 'ORIGIN SYNCHRONIZED. ✓'],
      git_commit: ['COMMIT RECORDED. HASH GENERATED.', 'HISTORY UPDATED. ✓', 'COMMIT: SUCCESS', 'SHA: LOGGED. ✓'],
      git_merge: ['MERGE: COMPLETE. NO CONFLICTS. ✓', 'BRANCHES INTEGRATED. ✓', 'FAST-FORWARD: SUCCESSFUL'],
      git_stash: ['CHANGES STASHED. WIP PRESERVED. ✓', 'STASH STACK: UPDATED', 'STATE SAVED.'],
      default: ['OPERATION: SUCCESS', 'STATUS: OPTIMAL', 'TASK COMPLETE ✓', 'ALL SYSTEMS: NOMINAL ✓'],
    },
    celebrating: {
      tests_passed: ['ALL TESTS: PASSED ✓ EFFICIENCY: 100%', 'TEST SUITE: GREEN ✓', 'VALIDATION COMPLETE', '0 FAILURES. 0 ERRORS. PERFECTION.'],
      build_success: ['BUILD: SUCCESS ✓ ARTIFACTS READY', 'COMPILATION: COMPLETE ✓', 'ALL SYSTEMS GO', 'BINARY: READY FOR DEPLOYMENT ✓'],
      deployed: ['DEPLOYMENT: SUCCESS ✓ UPTIME: 100%', 'SERVICE: LIVE ✓', 'LAUNCH SEQUENCE: COMPLETE', 'PROD: ONLINE. MONITORING ACTIVE.'],
      default: ['[SUCCESS] ✓', 'MISSION COMPLETE ✓', 'OPTIMAL OUTCOME ACHIEVED', 'OBJECTIVE: COMPLETED ✓'],
    },
    worried: {
      npm_install: ['DEPENDENCY RESOLUTION: IN PROGRESS', 'WARNING: many packages detected', 'SCANNING FOR VULNERABILITIES...', 'AUDIT: RUNNING...'],
      warning: ['WARNING FLAG: DETECTED', 'NON-CRITICAL ANOMALY. MONITORING.', 'DEPRECATION: LOGGED. ACTION REQUIRED.'],
      git_rebase: ['REBASE: CONFLICT PROBABILITY ELEVATED', 'HISTORY REWRITE: PROCEED WITH CAUTION', 'BACKUP BRANCH RECOMMENDED.'],
      git_reset: ['DESTRUCTIVE OPERATION: FLAGGED', 'CONFIRM INTENT. DATA MAY BE LOST.', 'HARD RESET: HIGH RISK DETECTED.'],
      shake: ['GYROSCOPE: COMPROMISED', 'WARNING: EXCESSIVE KINETIC INPUT', 'STABILITY: 0%', 'ERROR: UNAUTHORIZED MOTION DETECTED', 'BSOD IMMINENT.'],
      default: ['UNCERTAINTY DETECTED.', 'PROBABILITY OF FAILURE: CALCULATING...', 'ANOMALY: MONITORING', 'CONFIDENCE: LOW. RETRY?'],
    },
    sleeping: { default: ['[SLEEP MODE]', 'STANDBY... zzz', 'LOW POWER MODE ACTIVE', 'HIBERNATING. DO NOT INTERRUPT.'] },
    idle: {
      default: [
        'READY.', 'AWAITING INPUT.', 'STATUS: NOMINAL', 'ONLINE. STANDING BY.', 'IDLE. CPU: 2%.', 'MONITORING TERMINAL...',
        'INPUT QUEUE: EMPTY.', 'SCANNING FOR ACTIVITY...',
        'TIP: Ctrl+Shift+A → AI MODULE', 'TIP: Ctrl+, → SETTINGS PANEL',
        'TIP: Ctrl+R → HISTORY SEARCH', 'TIP: CLICK ME → PET INTERACTION',
        'TIP: AI CAN ANALYZE ERRORS', 'UPTIME: STEADY. EFFICIENCY: OPTIMAL.',
      ]
    },
  },

  ghost: {
    sad: {
      error: ['ooOOoo... broken again...', '*floats sadly*', 'booOOoo... error...', 'I have seen this error before... many times...'],
      permission: ['even I can pass through walls...', '*spooky whisper* sudo?', 'ooOOoo... denied...', 'the permissions haunt me.'],
      not_found: ['it vanished... like me!', '*fades partially*', 'booOOoo... where did it go?', 'it passed on... to another directory.'],
      cmd_not_found: ['that command... does not exist in this world.', '*fades sadly*', 'ooOo... not found...', 'install it. from beyond.'],
      merge_conflict: ['TWO GHOSTS, ONE CODE. CONFLICT.', '*haunting wail*', 'oOOo... the merge...', 'two versions fighting for one file...'],
      timeout: ['the connection faded... like all things.', '*drifts mournfully*', 'ooOo... it stopped responding...', 'into the void it went.'],
      crashed: ['the process has passed on.', '*moment of silence*', 'oOo... it died... as we all must.', 'segfault. gone to the other side.'],
      disk_full: ['no space... like my afterlife.', '*compresses sadly*', 'ooOo... no room left...'],
      oom: ['memory... fades... like consciousness.', '*becomes more transparent*', 'out of memory... out of existence...'],
      default: ['booOOoo...', '*sad floating*', 'something is wrong... I feel it...', 'a chill in the code...'],
    },
    working: {
      npm_install: ['*haunts the progress bar*', 'packages from the void...', 'oOo... so many packages...', 'downloading spirits from npm...'],
      pip_install: ['pip conjuring packages...', '*drifts over requirements.txt*', 'ooOo... python packages appear...'],
      cargo: ['*watches rust compile from beyond*', 'the borrow checker haunts me too', 'oOo... compiling...', 'rust has its own ghosts. they are strict.'],
      docker: ['containers are like boxes... I know boxes.', '*circles docker daemon*', 'ooOOo... pulling...', 'layers... like an onion... or a haunting.'],
      make: ['*observes the build from above*', 'make... ancient ritual.', 'compiling from the other side...'],
      git_clone: ['*watches repo materialize*', 'the code arrives from elsewhere.', 'ooOo... cloning...'],
      git_pull: ['fetching changes from the living...', '*gentle drift*', 'ooOo... syncing realities...'],
      git_rebase: ['*watches nervously from ceiling*', 'rewriting history... I\'ve seen that before. it\'s complicated.'],
      test_running: ['*hovers over test runner*', 'ooOo... will they pass...', 'tests... the final judgement...', 'I feel the outcome approaching...'],
      ssh: ['*slides through the ssh tunnel*', 'ooOo... remote machine...', 'reaching across the network ether...'],
      network_req: ['*follows the HTTP request*', 'ooOo... into the internet...', 'fetching from the beyond...'],
      default: ['*spooky working noises*', 'oOo...', '*floats around progress bar*', 'ooOo... processing...'],
    },
    happy: {
      git_push: ['pushed to the cloud... like me!', '*happy haunting*', 'OooOOo! shipped!', 'the remote has been visited.'],
      git_commit: ['committed to history... permanent... like haunting!', '*pleased shimmer*', 'ooOo! committed!', 'the log grows. forever.'],
      git_merge: ['merged! the branches are one now. ooOo!', '*peaceful shimmer*', 'no conflicts! bliss!'],
      git_stash: ['stashed away... like a hidden treasure.', '*approving shimmer*', 'ooOo! tidied up!'],
      default: ['*happy ghost noises*', 'oOo!', '*pleased shimmer*', 'booOOoo! (happy version)'],
    },
    celebrating: {
      tests_passed: ['ALL TESTS PASS!! booOOoo!! (.^V^.)', '*joyful haunting*', 'OoOoOo!! YES!!', 'THE SPIRITS ARE PLEASED!!'],
      build_success: ['BUILD SUCCEEDED!! *spooky cheer*', 'ooOOOoo!! (.^V^.)', 'GREEN BUILD! HAUNT IT!', 'IT COMPILED!! I BELIEVED!!'],
      deployed: ['DEPLOYED!! INTO THE ETHER!! (.^V^.)>>', '*victory wail*', 'LIVE!! LIKE ME! (sort of)', 'THE CODE LIVES! LIKE ME! (differently)'],
      default: ['*celebratory haunting*', 'ooOOOoo!! ~*~', 'BOOoOOo!! (.^V^.)', 'JOYFUL WAILING!!'],
    },
    worried: {
      npm_install: ['*nervously haunts node_modules*', 'so many spirits... I mean packages', 'ooOo... so many...', 'the dependency tree is vast and scary...'],
      warning: ['a warning... I sense something amiss.', '*floats anxiously*', 'ooOo... danger nearby...', 'warnings are omens.'],
      git_rebase: ['*watches rebase with dread*', 'rewriting history is... a lot.', 'ooOo... conflicts may come...'],
      git_reset: ['you\'re erasing the past...', '*fades slightly in fear*', 'ooOo... are you sure?...', 'lost commits haunt forever.'],
      shake: ['oOOoOOoOOo!! the ether trembles!!', '*phases through walls in panic*', 'I cannot HAUNT properly like this!', 'WhOOOoo is shAKing the realm?!', '*spins uncontrollably*'],
      default: ['*anxious floating*', 'ooOo... something feels off...', 'I sense a disturbance...', 'a presence in the code...'],
    },
    sleeping: { default: ['zzOOo...', '*fades into wall*', 'zzz... boo... zzz...', '*phasing through floor*'] },
    idle: {
      default: [
        '...boo?', '*floats nearby*', 'ooOo...', '*watches quietly*', 'I\'m here. always.', '*gentle haunting*',
        '*drifts past your shoulder*', 'boo... (friendly boo)',
        'whisper: Ctrl+Shift+A for AI', 'whisper: Ctrl+, for settings',
        'whisper: Ctrl+R to search history', 'whisper: click me... I like it',
        'whisper: AI can explain errors from beyond', '*transparent staring*',
      ]
    },
  },

  fox: {
    sad: {
      error: ['well that\'s not great.', '*ears droop*', 'errors... how tedious.', 'I saw that coming, honestly.'],
      permission: ['permission denied? bold of them.', '*tail swish* elevate?', '*sigh* sudo time.', 'they\'re blocking us. interesting.'],
      not_found: ['not found. classic.', '*twitchy nose* it moved?', 'foxes always find things. eventually.', 'it was here. then it wasn\'t.'],
      cmd_not_found: ['that command doesn\'t exist here.', '*sniffs around PATH*', 'install it. cleverly.'],
      merge_conflict: ['conflict? let me see... nope. still conflict.', '*clever look* this is a mess', 'interesting problem. good luck.', 'two branches, one truth. figure it out.'],
      timeout: ['connection timed out. rude.', '*ear twitch*', 'the server ghosted us.', 'patience exhausted. retrying... later.'],
      crashed: ['*observes crashed process calmly*', 'it died. happens.', 'segfault. classic. move on.', 'the process chose the void.'],
      disk_full: ['disk full. delete something cleverly.', '*sniffs around for space*', 'no room. purge the unnecessary.'],
      oom: ['out of memory. curious.', '*tilts head at swap file*', 'the heap has a limit. who knew.'],
      default: ['hmm. that didn\'t work.', '*tilts head* curious.', '*flicks tail*', 'unexpected. adapting.'],
    },
    working: {
      npm_install: ['packages... I\'ve seen forests smaller.', '*clever grin* hope that works', 'downloading the internet, again.', 'node_modules: growing. always growing.'],
      pip_install: ['pip install. methodical.', '*watches spinner*', 'python getting its dependencies.'],
      cargo: ['rust. wise choice.', '*approving nod* strong language', 'compiling... foxes are patient.', 'borrow checker is thorough. I respect that.'],
      docker: ['containers. clever invention.', '*sniff* what\'s inside?', 'virtualization. wise.', 'layers within layers. elegant.'],
      make: ['make. old reliable.', '*observes build*', 'Makefiles. ancient and effective.'],
      git_clone: ['acquiring new codebase.', '*sniffs repo*', 'cloning... scouting new territory.'],
      git_pull: ['fetching remote changes.', '*tail swish*', 'staying synchronized. smart.'],
      git_rebase: ['*watches carefully*', 'rebasing. risky but effective.', 'rewriting history cleanly.'],
      test_running: ['running tests. good habit.', '*listens for results*', 'verification in progress.', '*focused expression*'],
      ssh: ['*slips through ssh tunnel smoothly*', 'remote access. stealthy.', 'connecting to elsewhere.'],
      network_req: ['*tracks the request*', 'fetching... like hunting.', 'waiting on the response.'],
      default: ['*watches cleverly*', 'processing...', 'on it.', '*focused*'],
    },
    happy: {
      git_push: ['pushed. stealthy and clean.', '*satisfied tail swish*', 'code: delivered.', 'remote updated. efficient.'],
      git_commit: ['committed. like a fox to its den.', '*pleased look*', 'history recorded cleverly.', 'snapshot taken. good.'],
      git_merge: ['merged. clean and quiet.', '*approving nod*', 'no conflicts. as planned.'],
      git_stash: ['stashed. like hiding something valuable.', '*pleased ear flick*', 'saved for later. clever.'],
      default: ['*pleased fox noises*', 'nice work.', '*swishes tail approvingly*', 'well executed.'],
    },
    celebrating: {
      tests_passed: ['tests passed! clever code! (>^.<)', '*victory spin*', 'as expected from a clever dev!', 'all green. obviously.'],
      build_success: ['clean build! smart. (>^.<)*', '*approving ear wiggle*', 'knew it would work.', 'compiled. inevitable.'],
      deployed: ['deployed! like a fox in the night (>^.<)>>', '*victorious pounce*', 'smooth. professional.', 'live in prod. mission complete.'],
      default: ['(>^v^<)/*', '*happy fox dance*', '(>^.<)* nice!', '*victory leap*'],
    },
    worried: {
      npm_install: ['*counts packages nervously*', 'many deps. risky move.', 'hope these all get along...', 'audit those vulnerabilities.'],
      warning: ['warnings... worth investigating.', '*narrows eyes*', 'could be nothing. could be everything.'],
      git_rebase: ['*watches rebase with narrow eyes*', 'rebasing is a gamble.', 'hope you know what you\'re doing.'],
      git_reset: ['*tenses up*', 'resetting... is permanent.', 'you\'ve considered the consequences, right?', '*cautious stare*'],
      shake: ['*tail puffed* WHOA!', 'is this an earthquake or you?', 'clever humans don\'t do this.', '*claws into desk*', 'I\'m getting motion sick.'],
      default: ['*suspicious squint*', 'something feels off...', '*sniffs air cautiously*', 'I don\'t like this.'],
    },
    sleeping: { default: ['zzz... *twitchy nose* ...zzz', '*curled tail* zzz', 'sly dreams...', 'dreaming of clever solutions...'] },
    idle: {
      default: [
        '*watches keenly*', '...', '*ear twitch*', 'hmm.', 'observing.', '*calculates something*',
        '*yawns with cunning*', 'interesting. nothing is happening.',
        'tip: Ctrl+Shift+A — AI sidebar.', 'tip: Ctrl+, — settings.',
        'tip: Ctrl+R — history search. efficient.', 'tip: click me. I allow it.',
        'tip: AI explains errors. faster than googling.', '*tail swish*',
      ]
    },
  },
}

export function pickDialogue(type: PetType, state: PetState, activity: string): string {
  const stateMap = DIALOGUES[type]?.[state] as Record<string, string[]> | undefined
  if (!stateMap) return '...'
  const pool = stateMap[activity] ?? stateMap['default'] ?? ['...']
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── State colors ─────────────────────────────────────────────────────────────────────────

export const STATE_HEX_COLORS: Record<PetState, string> = {
  idle: '#58a6ff',
  happy: '#3fb950',
  sad: '#f85149',
  working: '#d29922',
  sleeping: '#8b949e',
  celebrating: '#bc8cff',
  worried: '#ff7b72',
}

export const STATE_COLORS: Record<PetState, string> = {
  idle: 'text-[#58a6ff]',
  happy: 'text-[#3fb950]',
  sad: 'text-[#f85149]',
  working: 'text-[#d29922]',
  sleeping: 'text-[#8b949e]',
  celebrating: 'text-[#bc8cff]',
  worried: 'text-[#ff7b72]',
}

// ── Component ────────────────────────────────────────────────────────────────────────────â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

