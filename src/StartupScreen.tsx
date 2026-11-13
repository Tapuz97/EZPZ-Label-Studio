import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Spinner } from "./components/ui/spinner";
import { Skeleton } from "./components/ui/skeleton";
import { assetUrl } from "./assets";
export function StartupScreen() {
  return (
    <main className="flex h-full items-center justify-center bg-background p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <img src={assetUrl("app-icon.svg")} className="mb-4 size-14" alt="" />
          <CardTitle>EZPZ Label Studio</CardTitle>
          <CardDescription>Preparing your workspace</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div role="status" className="flex items-center gap-3">
            <Spinner />
            Loading your labels…
          </div>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-2/3" />
        </CardContent>
      </Card>
    </main>
  );
}
