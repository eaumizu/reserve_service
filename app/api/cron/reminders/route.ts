import {NextRequest,NextResponse} from "next/server";
import {authorizeReminderCron,dispatchBookingReminders} from "../../../../lib/booking-reminders";
export const maxDuration=60;
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const headers={"Cache-Control":"private, no-store"};
 if(!authorizeReminderCron(request.headers.get("authorization")))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
 try{return NextResponse.json(await dispatchBookingReminders(null),{headers});}
 catch{return NextResponse.json({error:"Reminder processing failed"},{status:503,headers});}
}
