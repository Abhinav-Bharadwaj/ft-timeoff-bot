// Replace all the env.FT_LOCAL_API_KEY with the API token for freshteam account
// env.BEARER_TOKEN is the oauth access token provided by slack
// env.BOT_TOKEN is the bot user oauth access token provided by slack

const request = require('request');
const async=require('async')

const { WebClient } = require('@slack/web-api');
const token = process.env.BOT_TOKEN;
const web = new WebClient(token);

const port = process.env.PORT || 3000;

const moment=require('moment')
const tz=require('moment-timezone')

var opts=require('./apiConfig')
var options=opts.options

//var interview_form=require('./interview_format')
//var interview_block=interview_form.blocks


// This function takes in slack user id as input and returns a map which maps slack user emails in a workspace with their respective user ids.
// Only for the calling user this map maps the user id with email.The map also maps the user ids with their respective timezone
async function getMem(user){
  var memberMap=new Map()
  var time_zone=new Map()
  var promises=[]
  var promise=new Promise(function(resolve,reject){
      console.log("Fetching from Slack API ...");
     options.url='https://slack.com/api/users.list' // need to consider pagination
     options.headers.Authorization="Bearer "+process.env.BEARER_TOKEN // bearer token will change for each workspace. We need to maintain a map of team id and respective access token
      console.log("Processing ...");                                                                // the access token for a slack workspace is generated when the bot is installed.
      let results=request(options, function (error, response) {
         if (error) throw new Error(error);
         var members=JSON.parse(response.body).members
         for(var i=0;i<members.length;i++){
             time_zone[members[i].id]=members[i].tz
             if(members[i].id===user){
               memberMap[members[i].id]=members[i].profile.email
              }
             else{
              if(members[i].profile.email!==undefined){
              memberMap[members[i].profile.email]=members[i].id
               }
             }
          }
        resolve(memberMap)
      })
   })
   promises.push(promise)
   var promise=new Promise(function(resolve,reject){
        resolve(time_zone)
   })
   promises.push(promise)
   return Promise.all(promises)
}

// This function takes in freshteam emp id as input parameter and returns the user's remaining optional holidays
function opt_hol(id){
      return new Promise(function(resolve,reject){
             var opt_taken=0
             //console.log("Fetching from the API ... ");
              options.url='https://abhinavbharadwaj.freshhr.com/users/'+id+'/leave_balance'   // fetches the approved timeoff for the user and calaculates total optional holidays taken
              options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
              //console.log("Processing ... ");
              let res=request(options,function (error, response) {
                      if (error) throw new Error(error);
                      var leaves=JSON.parse(response.body)
                      var opt_rem=leaves.optional_days_allowed-leaves.optional_taken
                      resolve(opt_rem)
              })
      })
}


// This finction takes official_email of the user and returns the freshteam employee id of the user
function eid(caller){
  return new Promise(function(resolve,reject){
    options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
    options.url='https://abhinavbharadwaj.freshhr.com/api/employees?official_email='+caller
      let res=request(options,function (error, response) {
        if (error) throw new Error(error);
        var employees=JSON.parse(response.body)
        resolve(employees[0].id)
       })
    })
}

// function to return the list of employees who work under the manager and are on leave today
function timeoff(event){
  var today=new Date()
  today=today.toISOString().split('T')[0]
// function to return list of employees on leave today and working under the manager
  async function employees_on_leave(reporting_id,caller_email){

      return new Promise(function(resolve,reject){
        options.url='https://abhinavbharadwaj.freshhr.com/api/time_offs?start_date='+today+'&end_date='+today
        options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY

        let res=request(options,function (error, response) {
           if (error) throw new Error(error);
           var data=JSON.parse(response.body)
           var absentees=[]
           for (var i=0;i<data.length;i++){
             if(!absentees.includes(data[i].user_id) && reporting_id[data[i].user_id]===reporting_id[caller_email]) // condition to check if an absentee has not been already added to the list and if the reporting manager of that absentee is the caller of the function
                absentees.push(data[i].user_id)
            }
           resolve(absentees)
        })

      });
    }

var isManager=new Map()
var emails=new Map()

     // this function is for creating a map for mapping the employee id with the employee's reporting manager's employee id. It also takes a separate map and maps true for employee ids who are managers
     async function reporting(caller_email){

       var reporting_id=new Map()
       return new Promise(function(resolve,reject){
         options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
         options.url='https://abhinavbharadwaj.freshhr.com/api/employees'  // remember to take pagination into consideration

         let result=request(options,function (error, response) {
           if (error) {
             const result = web.chat.postMessage({
              text: "Sorry. Unable to contact the servers. Try again later.",
              channel:event.user
            });
             throw new Error(error);
           }
           var employees=JSON.parse(response.body)

           for(var i=0;i<employees.length;i++){

              emails[employees[i].id]=employees[i].official_email

              if(employees[i].reporting_to_id!==null){
               reporting_id[employees[i].id]=employees[i].reporting_to_id
               isManager[employees[i].reporting_to_id]=true
               }
               else {
                  reporting_id[employees[i].id]=employees[i].id
               }
               if(employees[i].official_email === caller_email){
                    reporting_id[caller_email]=employees[i].id // This extra pair in the map identifies callers email with his employee id
               }
            }
        //console.log(""+reporting_id)
        resolve(reporting_id)
      })
     })

}

var abs_id=[]
var caller_email

// The sequence of function calls begin here
    getMem(event.user).then(async function(memAndTz){
      var members=memAndTz[0]
      caller_email=members[event.user]
      await reporting(caller_email).then(async function(reporting_ids){

       if(isManager[reporting_ids[caller_email]]!==true){  //If the caller isnt a manager
         const result = web.chat.postMessage({
          text: "Sorry. You are not managing anyone currently.",
          channel:event.user
          });
       }

        else{
            await employees_on_leave(reporting_ids,caller_email).then(async function(users){
              for(var i=0;i<users.length;i++){
                 var email=emails[users[i]]
                 if(members[email]!==undefined){
                   abs_id.push(members[email])
                 }
               }
              console.log("The User ID(s) under "+members[caller_email]+" absent on "+today+" : "+abs_id)
              var blocks=[]

              // If there are some employees on leave
              if(abs_id.length>0){
                 var arr={"type": "section",
                    "text": {
                    "type": "mrkdwn",
                    "text": ""}
                  }
                 for(var i=0;i<abs_id.length;i++){
                 arr.text.text+=("<@"+abs_id[i]+">\n")
                  }
                  blocks.push(arr)

                const result = web.chat.postMessage({
                    blocks: blocks,
                    channel:event.user
                });
             }

         // Or if no one under the manager is on leve
             else{
                  const result = web.chat.postMessage({
                   text: "All onboard today",
                   channel:event.user
                  });
             }
           })
         }
      })
   })
}

// This function returns the hrbp of the caller.
function myhr(event){

  // this function takes the caller's official_email and gets the hr id of the caller and calls another function to get hr email
  function getHr(caller){
       return new Promise(function(resolve,reject){
       var hr
       //console.log("Fetching from API...");
       options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
       options.url='https://abhinavbharadwaj.freshhr.com/api/employees?official_email='+caller
       //console.log("Processing ...");
       let result=request(options,async function (error, response) {
         if (error) throw new Error(error);
         var employee=JSON.parse(response.body)
         var emp_hr_id=employee[0].hr_incharge_id
         console.log("The HRBP employee ID is "+emp_hr_id)
         await getHrEmail(emp_hr_id).then(function(hr_email){
               hr=hr_email
         })
         console.log("The HRBP email ID is "+hr)
         resolve(hr)
        })
    })
  }

  // function to retunr official_email of the hr
  function getHrEmail(id){

    return new Promise(function(resolve,reject){
       options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
       options.url='https://abhinavbharadwaj.freshhr.com/api/employees/'+id
       let result=request(options,function (error, response) {
         if (error) throw new Error(error);
         var employee=JSON.parse(response.body)
         resolve(employee.official_email)
      })
    })

  }

  // sequence of function calls begin here
  getMem(event.user).then(async function(memAndTz){
       var members=memAndTz[0]
       var caller_email=members[event.user]
       getHr(caller_email).then(function(hr){
         console.log("The HRBP is "+members[hr]+" and his contact detail : "+hr)
         var arr={"type": "section",
              "text": {
              "type": "mrkdwn",
              "text": ""}
            }
         arr.text.text+=("Hi, <@"+event.user+"> ! Your HRBP is <@"+members[hr]+">\n You can contact your HR through "+hr)  // returns hr's slack username and official_email
         var blocks=[]
         blocks.push(arr)
         const result = web.chat.postMessage({
          blocks: blocks,
          channel:event.user
          });
       })
    })
}

// function that returns the nearest public/optional holiday in the calendar year
function holiday(event){

   // function to read the holiday calendar of the user and see the next holiday. If its an optional holiday the function returns the details of the holidays
   // and searches for the neearest public holiday and returns the details of the public holiday in the user's calendar
   function calendar(caller){
         return new Promise(function(resolve,reject){
               var today=new Date()
               today=today.toISOString().split('T')[0]
               var hol_details=[]
               //console.log("Fetching from the API ... ");
               options.url='https://abhinavbharadwaj.freshhr.com/timeoff/settings/holiday_calendars?query_hash%5B0%5D%5Bcondition%5D=deleted&query_hash%5B0%5D%5Boperator%5D=eq&query_hash%5B0%5D%5Bvalue%5D=0'
               options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
               options.headers.accept='application/json'
               //console.log("Processing ...  ");
               let result=request(options,async function (error, response) {
                  if (error) throw new Error(error);
                    var holidays=JSON.parse(response.body).holiday_lists
                    var opt_holiday_accounted_for=false
                    var optional_count=JSON.parse(response.body).holiday_calendars[0].min_optional_holiday_count
                    for(var i=0;i<holidays.length;i++){

                       if(today<holidays[i].start_date){
                             // if the nearest holiday is an optional holiday
                             if(holidays[i].optional_holiday===true && opt_holiday_accounted_for===false){
                                 opt_holiday_accounted_for=true
                                 await opt_hol(caller).then(function(opt_rem){
                                     //if the user has optional holidays remaining
                                     console.log("Holiday : "+holidays[i].start_date)
                                     console.log("Holiday Name: "+holidays[i].name)
                                     console.log("Optional Holidays Remaining : "+opt_rem)
                                     if(opt_rem>0){
                                       const result = web.chat.postMessage({
                                        text:"Nearest holiday is on "+holidays[i].start_date+" for "+holidays[i].name+". But it's an optional holiday and you have "+opt_rem+" optional leave units left\n",
                                        channel:event.user
                                        });
                                     }

                                     else{
                                       const result = web.chat.postMessage({
                                        text:"Nearest holiday is on "+holidays[i].start_date+" for "+holidays[i].name+". But it's an optional holiday and you have no optional leave units left.\n",
                                        channel:event.user
                                        });
                                     }
                                 })
                             }
                             // checks if there is a public holiday coming
                             if(holidays[i].optional_holiday===false){
                                  hol_details.push(holidays[i].name)
                                  hol_details.push(holidays[i].start_date)
                                  break;
                             }
                       }
                    }
                      resolve(hol_details)
               })

          })
      }

     // sequence of function calls begins here
     getMem(event.user).then(function(memAndTz){
       var members=memAndTz[0]
       var caller=members[event.user]
         eid(caller).then(function(caller_id){
          calendar(caller_id).then(function(hol_details){
              // If there is any public holiday coming up in the calendar year
              if(hol_details.length>0){
                  var hol_name=hol_details[0]
                  var hol_date=hol_details[1]
                  console.log("Holiday : "+hol_date)
                  console.log("Holiday Name: "+hol_name)
                  const result = web.chat.postMessage({
                      text:"Hey. The closest public holiday is on "+hol_date+" for "+hol_name+".",
                      channel:event.user
                  });
              }
              else{
                console.log("No Holidays for the year")
                const result = web.chat.postMessage({
                   text:"There are no public holidays left for this calendar year.",
                   channel:event.user
               });
             }
           })
        })
     })

}

// This function returns the number of remaining optional holidays left for the caller.
function opt_balance(event){

   getMem(event.user).then(function(memAndTz){
      var members=memAndTz[0]
      var caller=members[event.user]
        eid(caller).then(function(caller_id){
                 opt_hol(caller_id).then(function(opt_rem){
                   console.log("The Remaining Optional Holidays for the Employee is "+opt_rem);
                   const result = web.chat.postMessage({
                      text:"Hi. You have "+opt_rem+" optional holidays left for this calendar year.",
                      channel:event.user
                    });
                 })
        })
    })
}

// This function returns the list of interviews for the caller on the particluar day.
function interviews(event){

  var interv={
  	"blocks": [
  		{
  			"type": "section",
  			"text": {
  				"type": "mrkdwn",
  				"text": ":calendar: |   *Interviews for today*  | :calendar: "
  			}
  		}
  	]
  }

  var interview_block=interv.blocks
  var interview_type,applicant_name,job,time

  // function calls start here. The caller's employee id is used to find out if the employee has any interviews scheduled today
  getMem(event.user).then(function(memAndTz){
     var members=memAndTz[0]
     var time_zone=memAndTz[1]
     var caller=members[event.user]
       eid(caller).then(function(caller_id){
         var today=new Date()
         today=today.toISOString().split('T')[0]
         options.headers.Authorization='Bearer '+process.env.FT_LOCAL_API_KEY
         options.headers.accept='application/json'
         options.url='https://abhinavbharadwaj.freshhr.com/hire/interviews?query_hash%5B0%5D%5Bcondition%5D=hiring_panel_member_id&query_hash%5B0%5D%5Boperator%5D=is_provided&query_hash%5B1%5D%5Bcondition%5D=schedule_time&query_hash%5B1%5D%5Boperator%5D=is_on&query_hash%5B1%5D%5Bvalue%5D='+today+'%2000%3A00%3A00&query_hash%5B2%5D%5Bcondition%5D=hiring_panel_member_id&query_hash%5B2%5D%5Boperator%5D=is&query_hash%5B2%5D%5Bvalue%5D='+caller_id+'&page=1&sort=schedule_time&sort_type=asc'
         let result=request(options,async function (error, response) {
             if (error) throw new Error(error);
             var interviews_list=JSON.parse(response.body).interviews
             // If no interviews are shceduled for the day
             if(interviews_list.length === 0){
               console.log("No Interviews scheduled today for the user "+members[caller]);
               const result = web.chat.postMessage({
                text: "You have no interviews scheduled for today.",
                channel:event.user
                });
             }
             // else return the following : interview time in the user's respective timezone , interview stage, interview's applicant name and Job role for which interview is to be done
               var applicants=JSON.parse(response.body).applicants
               var stages=JSON.parse(response.body).interview_stages
               var jobs=JSON.parse(response.body).jobs
               var leads=JSON.parse(response.body).leads

               for(var i=0;i<interviews_list.length;i++){

                    if(interviews_list[i].hiring_panel_member_id === caller_id){

                          time=interviews_list[i].schedule_time
                          time=moment(time)
                          time=time.tz(time_zone[event.user]).format('HH:mm');

                          var applicant=interviews_list[i].applicant_id
                          var stage=interviews_list[i].stage_id
                          var interview_type,applicant_name="",jobconso

                          // A loop to identify the stage of the interview to be taken
                          for(var j=0;j<stages.length;j++){
                              if(stages[j].id === stage){
                                 interview_type=stages[j].name
                                 break;
                              }
                          }

                          // A loop to find details of the applicant attending the interview
                          for(var j=0;j<applicants.length;j++){
                            applicant_name=""
                              if(applicants[j].id === applicant){
                                     var job_id=applicants[j].job_id
                                     var lead_id=applicants[j].lead_id

                                     // A loop to find the job title of the job that the applicant has applied for
                                     for(var x=0;x<jobs.length;x++){
                                           if(jobs[x].id === job_id){
                                              job=jobs[x].title
                                              break;
                                           }
                                     }

                                     // A loop for getting the details of the applicant's name
                                     for(var x=0;x<leads.length;x++){
                                           if(leads[x].id === lead_id){
                                             console.log("lead "+leads[x].first_name+" applicant "+applicant+" lead id "+lead_id)
                                             if(leads[x].first_name!==null){
                                              applicant_name+=leads[x].first_name
                                              applicant_name+=" "

                                            }
                                            if(leads[x].middle_name!==null){
                                              applicant_name+=leads[x].middle_name
                                              applicant_name+=" "

                                            }
                                            if(leads[x].last_name!==null){
                                              applicant_name+=leads[x].last_name

                                            }
                                              break;
                                           }
                                     }
                                     if(interviews_list[i].cancelled_by_id != null){
                                       const result = web.chat.postMessage({
                                        text: "Your interview previously scheduled with "+applicant_name+" at "+time+" is now cancelled.",
                                        channel:event.user
                                        });
                                     }
                                     else{
                                       var arr={
                                   			"type": "section",
                                   			"text": {
                                   				"type": "mrkdwn",
                                   				"text": ":watch: `"+time+"`  *"+job+" | "+interview_type+"* _for candidate_ *"+applicant_name+"*"
                                   			}
                                     }
                                 		}
                                     interview_block.push(arr)
                              }
                    }
                }


                const result = web.chat.postMessage({
                 blocks: interview_block,
                 channel:event.user
                 });

             }
         })
       })
     })
}

exports.timeoff=timeoff
exports.myhr=myhr
exports.holiday=holiday
exports.opt_balance=opt_balance
exports.interviews=interviews
