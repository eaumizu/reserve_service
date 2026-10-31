import { PublicBooking } from "@/components/PublicBooking";
import { BookingPolicies } from "@/components/BookingPolicies";
import { defaultStoreName } from "@/lib/store-public";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: `${await defaultStoreName()} | ご予約` }; }
export default async function Home() {
  return <main><p className="eyebrow">{await defaultStoreName()}</p><h1>ご予約</h1><PublicBooking /><BookingPolicies /></main>;
}
