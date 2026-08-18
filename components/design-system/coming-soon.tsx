import { Card } from "@/components/design-system/card";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-10">
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">{title}</h1>
      <p className="mb-6 text-sm text-text-muted">{description}</p>
      <Card className="max-w-md">
        <p className="text-sm text-text-secondary">Coming soon in a later phase.</p>
      </Card>
    </div>
  );
}
