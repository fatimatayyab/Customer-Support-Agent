"use client";

import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { Field, Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { type Theme, getEffectiveTheme, setTheme } from "@/lib/theme";

interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

export default function SettingsPage() {
  const router = useRouter();
  const { workspace } = useSession();
  const { showToast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    apiFetch<{ user: Me }>("/workspaces/me")
      .then((data) => {
        setMe(data?.user ?? null);
        setName(data?.user?.name ?? "");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setPasswordError(err instanceof ApiError ? err.message : "Could not load account.");
      });
  }, [router]);

  useEffect(() => {
    setThemeState(getEffectiveTheme());
  }, []);

  function selectTheme(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setNameError(null);
    try {
      await apiFetch("/workspaces/me", { method: "PATCH", body: JSON.stringify({ name }) });
      setMe((current) => (current ? { ...current, name } : current));
      showToast("Name updated", "success");
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not update name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiFetch("/workspaces/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated", "success");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Could not change password.");
    } finally {
      setChangingPassword(false);
    }
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <PageSkeleton />
      </div>
    );
  }

  const initial = me.name.trim().charAt(0).toUpperCase() || me.email.charAt(0).toUpperCase();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>

      <Card>
        <CardHeader title="Profile" description="Your identity in this workspace." />
        <CardBody className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-xl font-semibold text-on-fill">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-slate-900">{me.name}</div>
              <div className="truncate text-sm text-slate-500">
                {ROLE_LABELS[me.role] ?? me.role} · {workspace.name}
              </div>
              <div className="truncate text-sm text-slate-400">{me.email}</div>
            </div>
          </div>

          <form onSubmit={handleSaveName} className="flex flex-col gap-5 border-t border-slate-100 pt-5">
            <Field label="Name" hint="How your teammates see you." required>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
            </Field>

            <div className="grid gap-5 sm:grid-cols-3">
              <ReadonlyField label="Email" value={me.email} />
              <ReadonlyField label="Role" value={ROLE_LABELS[me.role] ?? me.role} />
              <ReadonlyField label="Workspace" value={workspace.name} />
            </div>

            {nameError && <InlineError message={nameError} />}
            <Button type="submit" disabled={savingName} className="self-start">
              {savingName ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Password" description="Use at least 8 characters." />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <PasswordField
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
            />
            <PasswordField
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              minLength={8}
              required
            />
            {passwordError && <InlineError message={passwordError} />}
            <Button type="submit" disabled={changingPassword} className="self-start">
              {changingPassword ? "Updating..." : "Update password"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Appearance" description="Choose how the dashboard looks for you." />
        <CardBody>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => selectTheme("light")}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                theme === "light" ? "border-brand bg-brand text-on-fill" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Sun className="h-4 w-4" />
              Light
            </button>
            <button
              type="button"
              onClick={() => selectTheme("dark")}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                theme === "dark" ? "border-brand bg-brand text-on-fill" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Moon className="h-4 w-4" />
              Dark
            </button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        {value}
      </span>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} required={required}>
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}