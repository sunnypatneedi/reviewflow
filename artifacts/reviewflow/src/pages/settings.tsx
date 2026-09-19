import { useGetBootstrap } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SimulatedBadge } from "@/components/simulated-badge";

export default function Settings() {
  const { data: config, isLoading } = useGetBootstrap();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading settings...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Workbench configuration and policy status</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wider text-muted-foreground">Project Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Project Name</div>
                <div className="text-lg font-semibold">{config?.projectName}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Active Mode</div>
                <div className="text-lg flex items-center gap-2">
                  <span className="capitalize font-semibold">{config?.mode}</span>
                  <SimulatedBadge mode={config?.mode as 'demo' | 'live'} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wider text-muted-foreground">Model & Policies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Provider & Model</div>
                <div className="text-base font-mono bg-secondary/50 px-3 py-1.5 rounded-md inline-block border border-border/50">{config?.providerModel}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Shadow Policy Version</div>
                <div className="text-base font-mono bg-secondary/50 px-3 py-1.5 rounded-md inline-block border border-border/50">{config?.shadowPolicyVersion}</div>
              </div>
              <div className="col-span-2 pt-4 border-t border-border">
                <div className="text-sm font-medium text-muted-foreground mb-2">Live API Credentials</div>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${config?.liveCredentialConfigured ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-destructive'}`} />
                  <span className="text-sm font-medium">{config?.liveCredentialConfigured ? 'Configured and ready' : 'Not configured. Live evaluations will fail.'}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
