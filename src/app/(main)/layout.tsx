import React from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ChannelCard } from "@/components/layout/ChannelCard";
import { TodayProvider } from "@/lib/india-today";
import { indiaDay } from "@/lib/lifecycle";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The India date this page is drawn on: date-dependent components hydrate with it, then move to the visitor's date.
  const renderedOn = indiaDay(new Date());
  return (
    <TodayProvider renderedOn={renderedOn}>
      <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
        <Header />
        <main className="flex-1">{children}</main>
        <ChannelCard />
        <Footer />
      </div>
    </TodayProvider>
  );
}
