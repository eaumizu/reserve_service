import { CustomerBookingManager } from "../../components/CustomerBookingManager";
import { BookingPolicies } from "../../components/BookingPolicies";
export const metadata={title:"予約確認・変更・キャンセル",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default function Page(){return <main><h1>予約確認・変更・キャンセル</h1><CustomerBookingManager /><BookingPolicies /></main>;}
