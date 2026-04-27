import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupViewBanner } from "./GroupViewBanner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// apiFetch is called by handleExit, not during render — no need to mock for
// these render-only tests. If we add interaction tests we'd mock it here.
vi.mock("../../lib/api", () => ({
  apiFetch: vi.fn(),
}));

describe("GroupViewBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders nothing when brandViewing flag is not set", () => {
    const { container } = render(<GroupViewBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when brandViewing=true but no merchant in localStorage", () => {
    localStorage.setItem("brandViewing", "true");
    // merchant not set
    const { container } = render(<GroupViewBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the banner when brandViewing flag is set and merchant is in localStorage", () => {
    localStorage.setItem("brandViewing", "true");
    localStorage.setItem("merchant", JSON.stringify({ id: "branch-2", name: "Branch B" }));
    localStorage.setItem("homeMerchantName", "Branch A");
    render(<GroupViewBanner />);
    expect(screen.getByText(/viewing/i)).toBeInTheDocument();
    expect(screen.getByText(/Branch B/)).toBeInTheDocument();
    expect(screen.getByText(/End view/)).toBeInTheDocument();
  });

  it("shows the home merchant name in the End view button", () => {
    localStorage.setItem("brandViewing", "true");
    localStorage.setItem("merchant", JSON.stringify({ id: "branch-2", name: "Branch B" }));
    localStorage.setItem("homeMerchantName", "My Home Spa");
    render(<GroupViewBanner />);
    expect(screen.getByText(/My Home Spa/)).toBeInTheDocument();
  });

  it("falls back to 'your home branch' when homeMerchantName is not set", () => {
    localStorage.setItem("brandViewing", "true");
    localStorage.setItem("merchant", JSON.stringify({ id: "branch-2", name: "Branch B" }));
    // homeMerchantName not set
    render(<GroupViewBanner />);
    expect(screen.getByText(/your home branch/i)).toBeInTheDocument();
  });
});
