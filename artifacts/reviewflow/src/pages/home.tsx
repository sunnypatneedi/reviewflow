import { Link } from "wouter";
import { useGetMetrics, useGetBootstrap } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatPercent } from "@/lib/utils";
import { Activity, AlertTriangle, CheckCircle, Clock, FileText, Target } from "lucide-react";

export default function Home() {
  const { data: metrics, isLoading: loadingMetrics, error: metricsError, refetch: refetchMetrics } = useGetMetrics();
  const { data: bootstrap, isLoading: loadingBootstrap, error: bootstrapError, refetch: refetchBootstrap } = useGetBootstrap();

  if (loadingMetrics || loadingBootstrap) {
    return <div className="p-8 text-muted-foreground">Loading overview...</div>;
  }
  const loadError = bootstrapError ?? metricsError;
  if (loadError) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>ReviewFlow unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-destructive">
            <p>{loadError.message}</p>
            <Button
              type="button"
              variant="ghost"
              className="text-text-secondary"
              onClick={() => {
                void refetchBootstrap();
                void refetchMetrics();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pending = metrics?.pending ?? 0;
  const ctaLabel = pending > 0 ? "Continue reviewing" : "Start review";

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-2">Project: {bootstrap?.projectName} • Model: {bootstrap?.providerModel}</p>
        </div>
        <Link
          href="/review"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          {ctaLabel}
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Tasks" value={metrics?.total} icon={<FileText className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Pending Review" value={metrics?.pending} icon={<Activity className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Finalized" value={metrics?.finalized} icon={<CheckCircle className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Escalated" value={metrics?.escalated} icon={<AlertTriangle className="w-4 h-4 text-muted-foreground" />} />
        
        <MetricCard title="Corrections" value={`${metrics?.corrections} / ${metrics?.correctionDenominator}`} icon={<Target className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Independent Accuracy" value={metrics?.independentAccuracy != null ? formatPercent(metrics.independentAccuracy) : "N/A"} icon={<Target className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Avg Review Time" value={metrics?.averageReviewMs ? `${(metrics.averageReviewMs / 1000).toFixed(1)}s` : "N/A"} icon={<Clock className="w-4 h-4 text-muted-foreground" />} />
        <MetricCard title="Avg Latency" value={metrics?.averageLatencyMs ? `${metrics.averageLatencyMs.toFixed(0)}ms` : "N/A"} icon={<Activity className="w-4 h-4 text-muted-foreground" />} />
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string, value: any, icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value ?? "-"}</div>
      </CardContent>
    </Card>
  );
}
