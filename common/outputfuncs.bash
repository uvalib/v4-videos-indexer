
#define the function
#xargs -0 ls -1 -t % 2> /dev/null | head -1
find_newest_file_matching_pattern_under_directory(){
    echo $(find $1 -maxdepth 1 -name "$2" -print0 | xargs -0 ls -1 -t % 2> /dev/null | head -1)
}

verbose=

#function to delete unwanted messages from solrmarc output
# return 1 to say dont print this line
# return 0 to say do print this line
function solrout ()
{
    solrdelete=("Added record [0-9]* read from file:" "No queryConverter defined" "SpellCheckComponent inform" "SolrUpdate.java:152", "SimplePostTool: POSTing file") 
    string=$1
    for ix in ${!solrdelete[*]}
    do
        #echo "$string" '.*'"${solrdelete[$ix]}"'.*' 
        pattern='.*'"${solrdelete[$ix]}"'.*'
        if [[ "$string" =~ $pattern ]]
        then 
            return 1
        fi
    done
    return 0
}

#function to emit output only if the verbose flag is set
#Will prefix each line with the corename and an optional indenting
# return 1 to say dont print this line
# return 0 to say do print this line
function vlog ()
{
    oldIFS=$IFS
    IFS='\n'
    indent=
    if [ "$#" -gt "0" ] ; then indent=$1 ; fi
    while read data
    do
        if [ "$verbose" == "-v" ] 
        then 
            if solrout "$data"
            then 
                echo "$corename: $indent$data"
            fi
        fi
    done
    IFS=$oldIFS
}

#function will prefix each line with the corename and an optional indenting
# return 1 to say dont print this line
# return 0 to say do print this line
function log ()
{
    oldIFS=$IFS
    IFS='\n'
    indent=
    if [ "$#" -gt "0" ] ; then indent=$1 ; fi
    while read data
    do
        if solrout "$data" ; then 
            echo "$corename: $indent$data"
        fi
    done
    IFS=$oldIFS
}

#Analogous to echo, but only if the verbose flag is set
function Verbose ()
{
    echo "$1"  | vlog
}

#Analogous to echo, but passes through the log function to prefix lines with corename
function Echo ()
{
    echo "$1"  | log
}

# Status lines that CloudWatch alarms watch for (see the v4-video-indexer
# cloud-watch.tf in terraform-infrastructure). Each provider should emit
# VIDEO_INDEXER_OK once per successful run (a heartbeat alarm fires if it goes
# missing) and VIDEO_INDEXER_ALERT whenever something needs a human to look.
# These are echoed directly rather than through log() so they always appear,
# verbose or not, and are never altered by log()'s read/IFS handling.
function StatusOK ()
{
    echo "$corename: VIDEO_INDEXER_OK provider=$corename $*"
}

# usage: StatusAlert <reason> [key=value ...]
function StatusAlert ()
{
    local reason=$1
    shift
    echo "$corename: VIDEO_INDEXER_ALERT provider=$corename reason=$reason $*"
}

# The puppeteer scripts leave a key=value scrape_result file in their data
# directory saying how far they got.  usage: scrape_result_field <file> <key>
function scrape_result_field ()
{
    sed -n "s/^$2=//p" "$1" 2>/dev/null | head -1
}

# One-line summary of a failed scrape, for inclusion in a StatusAlert line.
function scrape_failure_summary ()
{
    local file=$1
    if [[ ! -s "$file" ]] ; then
        echo "step=unknown detail=\"scraper left no scrape_result file\""
        return
    fi
    echo "step=$(scrape_result_field $file step) detail=\"$(scrape_result_field $file error)\" screenshot=$(scrape_result_field $file diagnostics)"
}

# Lets the bash wrappers record a failure they detect themselves (e.g. the
# download finished but isn't a valid zip) in the same format.
# usage: write_scrape_result <file> <step> <error message>
function write_scrape_result ()
{
    printf 'status=failed\nprovider=%s\nstep=%s\nerror=%s\ndiagnostics=\ntime=%s\n' \
        "$corename" "$2" "$(echo "$3" | tr -d '"\n')" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$1"
}
