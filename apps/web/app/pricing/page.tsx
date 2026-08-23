import Link from "next/link";
import { SessionsBrand } from "../../components/SessionsBrand";

const plans = [
  {
    key: "developer",
    name: "Developer",
    price: "$49",
    cadence: "/month",
    description: "For individual developers who want persistent engineering memory, verified work and recovery across human + AI development.",
    features: ["Private repositories", "Persistent Sessions", "Verified commits", "AI/human provenance", "Recovery + continuation", "CLI + VS Code access"],
  },
  {
    key: "team",
    name: "Team",
    price: "$299",
    cadence: "/month",
    description: "For engineering teams coordinating developers and AI workers across repositories, reviews, Actions and recovery.",
    features: ["Everything in Developer", "Team workspaces", "Pull requests + reviews", "Actions evidence", "Shared recovery context", "Usage controls"],
    featured: true,
  },
  {
    key: "business",
    name: "Business",
    price: "$999",
    cadence: "/month",
    description: "For organizations that need governed AI engineering, stronger controls, higher capacity and operational visibility.",
    features: ["Everything in Team", "Advanced authorization", "Higher quotas", "Operational analytics", "Priority support", "Commercial controls"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description: "For large deployments requiring dedicated capacity, security review, custom infrastructure and enterprise support.",
    features: ["Dedicated deployment options", "Enterprise governance", "Custom quotas", "Migration assistance", "Security review", "Support agreements"],
  },
];

export default function PricingPage() {
  return (
    <main className="commerce-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links">
          <Link href="/">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Repositories</Link>
          <Link href="/onboarding?plan=developer" className="button sessions-primary">Start with Sessions</Link>
        </div>
      </nav>

      <section className="commerce-hero">
        <div className="sessions-section-label">Commercial plans</div>
        <h1>Git-familiar development.<br />Persistent engineering underneath.</h1>
        <p>Sessions is paid infrastructure for developers and teams that need software work to remain understandable, verifiable and recoverable across humans and AI systems.</p>
      </section>

      <section className="pricing-grid" aria-label="Sessions pricing plans">
        {plans.map((plan) => (
          <article className={`pricing-card${plan.featured ? " featured" : ""}`} key={plan.key}>
            {plan.featured ? <div className="pricing-badge">Recommended</div> : null}
            <h2>{plan.name}</h2>
            <div className="pricing-price"><strong>{plan.price}</strong><span>{plan.cadence}</span></div>
            <p>{plan.description}</p>
            <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <Link href={`/onboarding?plan=${plan.key}`} className={`button button-large ${plan.featured ? "sessions-primary" : "sessions-secondary"}`}>
              {plan.key === "enterprise" ? "Start enterprise setup" : `Choose ${plan.name}`}
            </Link>
          </article>
        ))}
      </section>

      <section className="commerce-proof">
        <div><strong>Git knows what changed.</strong><span>Sessions preserves why it changed, who or what changed it, what ran, what passed, what failed, and how to continue.</span></div>
        <div><strong>No free-tier dependency.</strong><span>Paid plans are tied to real entitlements, usage limits, payment state, export and cancellation behavior.</span></div>
        <div><strong>Designed for switching.</strong><span>Repositories, commits, branches, pull requests and Actions keep familiar names while Sessions adds richer evidence underneath.</span></div>
      </section>
    </main>
  );
}
