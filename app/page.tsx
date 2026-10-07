import { BookingFlow } from "@/components/BookingFlow";
import { defaultStoreName } from "@/lib/store-public";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: `${await defaultStoreName()} | ご予約` }; }
export default async function Home() {
  return <main><p className="eyebrow">{await defaultStoreName()}</p><h1>ご予約</h1><p className="muted">メニューと日時を選び、かんたんにご予約いただけます。</p><BookingFlow /></main>;
}
