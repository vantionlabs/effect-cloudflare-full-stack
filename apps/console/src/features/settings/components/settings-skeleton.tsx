/**
 * What a client-side navigation to Settings shows while its loader runs — the page's shape, not "Laden…". A server
 * render arrives with the data and never shows this.
 */
import { Skeleton, SkeletonTable } from "@/components/feedback/skeleton"
import { Page } from "@/components/layout/page"

export function SettingsSkeleton() {
  return (
    <Page>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-8 md:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="hidden flex-col gap-2 md:flex">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-28 w-full rounded-card" />
          <SkeletonTable rows={3} columns={4} label="Leden worden geladen" />
          <SkeletonTable rows={2} columns={4} label="Uitnodigingen worden geladen" />
        </div>
      </div>
    </Page>
  )
}
