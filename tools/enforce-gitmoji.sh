#!/usr/bin/env sh
LC_ALL=C

valid_emoji_regex="$1"

message="Prefix commits with gitmojis."

commit=$(cat $2)

# Check if a merge is in progress
merge=$(git rev-parse -q --verify MERGE_HEAD)
if [ ! -z "$merge" ]
then
    echo 🔀 $commit > $2
    exit 0
fi

if [[ ! $commit =~ $valid_emoji_regex ]]
then
    echo "$message"
    exit 1
fi

exit 0