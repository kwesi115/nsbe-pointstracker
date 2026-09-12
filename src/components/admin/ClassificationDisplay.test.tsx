// @vitest-environment jsdom
/**
 * Classification renders in title case on the surfaces that show it.
 *
 * format.test.ts covers the formatter; this covers the wiring — that each table
 * actually calls it, rather than rendering the raw lowercase enum as they all
 * used to. The formatter being shared is what makes two assertions enough.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(member)/admin/attendance/actions", () => ({
  loadAttendeesAction: vi.fn(),
  previewRemoveAction: vi.fn(),
  removeRegistrationAction: vi.fn(),
  updateRegistrationPointsAction: vi.fn(),
}));
vi.mock("@/app/(member)/admin/members/pagination-actions", () => ({ loadMembersPageAction: vi.fn() }));
vi.mock("@/app/(member)/admin/members/actions", () => ({
  bulkSetRoleAction: vi.fn(),
  bulkVerifyDuesAction: vi.fn(),
  bulkVerifyNationalAction: vi.fn(),
  setRoleAction: vi.fn(),
  correctHouseAction: vi.fn(),
  setEboardPositionAction: vi.fn(),
  resetPasswordAction: vi.fn(),
}));

import { ToastProvider } from "@/components/ui/Toast";
import AttendeeTable from "./AttendeeTable";
import type { AttendeeRow } from "@/lib/repo";

const ROW: AttendeeRow = {
  registrationId: "r1",
  email: "ada@bison.howard.edu",
  firstName: "Ada",
  lastName: "Lovelace",
  classification: "junior",
  house: "Latimer",
  checkedInAt: new Date("2026-09-01T18:30:00Z"),
  pointsAwarded: 3,
  source: "form",
  note: "",
} as AttendeeRow;

describe("the attendance table", () => {
  it("renders a stored 'junior' as 'Junior'", () => {
    render(
      <ToastProvider>
        <AttendeeTable
          eventId="e1"
          initialPage={{ rows: [ROW], nextCursor: null, total: 1, totalPoints: 3 }}
          canWrite={false}
        />
      </ToastProvider>,
    );

    expect(screen.getByText("Junior")).toBeTruthy();
    // The raw enum value never reaches the page.
    expect(screen.queryByText("junior")).toBeNull();
  });

  it("renders 'graduate' with its full label", () => {
    render(
      <ToastProvider>
        <AttendeeTable
          eventId="e1"
          initialPage={{
            rows: [{ ...ROW, classification: "graduate" }],
            nextCursor: null,
            total: 1,
            totalPoints: 3,
          }}
          canWrite={false}
        />
      </ToastProvider>,
    );

    expect(screen.getByText("Graduate Student")).toBeTruthy();
  });

  it("shows a dash, not an empty cell, when there is no classification on file", () => {
    render(
      <ToastProvider>
        <AttendeeTable
          eventId="e1"
          initialPage={{ rows: [{ ...ROW, classification: "" }], nextCursor: null, total: 1, totalPoints: 3 }}
          canWrite={false}
        />
      </ToastProvider>,
    );

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
