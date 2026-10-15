function add(group, line) {
    item[group, ++count[group]] = line
}

{
    sub(/^\n+/, "", $1)
    if ($1 == "") {
        next
    }
    if (omitted != "" && index(" " omitted " ", " " $4 " ") > 0) {
        next
    }
    if (included != "" && index(" " included " ", " " $4 " ") == 0) {
        next
    }
    sha = $1
    subject = $2
    body = $3
    mergeReference = ""
    if (match(subject, /^Merge pull request #[0-9]+ from /)) {
        mergeReference = substr(subject, 1, RLENGTH)
        sub(/^Merge pull request /, " (", mergeReference)
        sub(/ from $/, ")", mergeReference)
    }
    if (subject ~ /^Merge branch .* into / || mergeReference != "") {
        mergeTitle = body
        sub(/^\n+/, "", mergeTitle)
        sub(/\n.*/, "", mergeTitle)
        if (mergeTitle != "" && mergeTitle !~ /^See merge request /) {
            subject = mergeTitle
        }
    }
    group = "Maintenance"
    breaking = ""
    if (body ~ /BREAKING[ -]CHANGE:/) {
        breaking = "**BREAKING** "
    }
    if (subject ~ /^Revert/) {
        group = "Reverts"
    } else if (match(subject, /^[a-z]+(\([^)]*\))?!?: /)) {
        head = substr(subject, 1, RLENGTH)
        rest = substr(subject, RLENGTH + 1)
        type = head
        sub(/[(!:].*/, "", type)
        scope = ""
        if (match(head, /\([^)]*\)/)) {
            scope = substr(head, RSTART + 1, RLENGTH - 2)
        }
        if (head ~ /!: $/ || body ~ /BREAKING CHANGE:/) {
            breaking = "**BREAKING** "
        }
        if (type == "feat") {
            group = "Features"
        } else if (type == "fix") {
            group = "Fixes"
        } else if (type == "perf") {
            group = "Performance"
        } else if (type == "revert") {
            group = "Reverts"
        }
        subject = (scope != "" ? scope ": " : "") rest
    }
    request = mergeReference
    if (match(body, /See merge request [^ \n]*![0-9]+/)) {
        request = substr(body, RSTART, RLENGTH)
        sub(/.*!/, " (!", request)
        request = request ")"
    }
    original = $5
    sub(/\n+$/, "", original)
    add(group, "- " breaking subject request " `" sha "`" (original != "" ? " (main `" original "`)" : ""))
}

END {
    split("Features Fixes Performance Reverts Maintenance", wanted, " ")
    for (i = 1; i <= 5; i++) {
        group = wanted[i]
        if (group in count) {
            print ""
            print "### " group
            for (j = 1; j <= count[group]; j++) {
                print item[group, j]
            }
        }
    }
}
