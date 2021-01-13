
#define the function
find_newest_file_matching_pattern_under_directory(){
    echo $(find $1 -maxdepth 1 -name "$2" -print0 | xargs -0 ls -1 -t | head -1)
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
