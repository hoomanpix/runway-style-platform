import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MobileAuthError, useAuth } from "@/lib/auth-context";
import { AvatarApiClient, AvatarApiClientError } from "@/lib/avatar-api";
import { AvatarWorkflow, MissingPhotoViewsError, type SelectedAvatarPhoto } from "@/lib/avatar-workflow";
import { mobileConfig, supabase } from "@/lib/supabase";
import type { AvatarPhotoContentType, AvatarPhotoView, GetAvatarResponse } from "@runway/types";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { colors, spacing } from "@/theme";

const PHOTO_VIEWS: readonly AvatarPhotoView[] = ["front", "left", "right", "back"];
const VIEW_LABELS: Record<AvatarPhotoView, string> = {
  front: "Front",
  left: "Left side",
  right: "Right side",
  back: "Back",
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const workflowStorage = Platform.OS === "web"
  ? {
      getItem: async (key: string) => localStorage.getItem(key),
      setItem: async (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: async (key: string) => localStorage.removeItem(key),
    }
  : {
      getItem: SecureStore.getItemAsync,
      setItem: SecureStore.setItemAsync,
      removeItem: SecureStore.deleteItemAsync,
    };

export default function UploadScreen() {
  const { configured, loading: authLoading, session, signIn, signOut, signUp } = useAuth();
  const [snapshot, setSnapshot] = useState<GetAvatarResponse | null>(null);
  const [selected, setSelected] = useState<Partial<Record<AvatarPhotoView, SelectedAvatarPhoto>>>({});
  const [loadingAvatar, setLoadingAvatar] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingView, setUploadingView] = useState<AvatarPhotoView | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const workflowRef = useRef<AvatarWorkflow | null>(null);
  const submitLock = useRef(false);

  function acceptServerSnapshot(value: GetAvatarResponse) {
    setSnapshot(value);
    setSelected((current) => {
      const next = { ...current };
      for (const photo of value.photos) delete next[photo.view];
      return next;
    });
  }

  useEffect(() => {
    const authClient = supabase;
    if (!session || !authClient) {
      workflowRef.current = null;
      setSnapshot(null);
      setSelected({});
      return;
    }

    let active = true;
    setSelected({});
    setLoadingAvatar(true);
    setError("");
    try {
      const api = new AvatarApiClient({
        baseUrl: mobileConfig.apiBaseUrl,
        async getAccessToken() {
          const { data, error: sessionError } = await authClient.auth.getSession();
          if (sessionError) throw sessionError;
          return data.session?.access_token ?? null;
        },
        async onUnauthorized() {
          await authClient.auth.signOut();
        },
      });
      const workflow = new AvatarWorkflow(
        api,
        workflowStorage,
        session.user.id,
        () => Crypto.randomUUID()
      );
      workflowRef.current = workflow;
      void workflow.resume().then((value) => {
        if (active) acceptServerSnapshot(value);
      }).catch((cause: unknown) => {
        if (active) setError(messageForError(cause));
      }).finally(() => {
        if (active) setLoadingAvatar(false);
      });
    } catch (cause) {
      setError(messageForError(cause));
      setLoadingAvatar(false);
    }

    return () => {
      active = false;
    };
  }, [session?.user.id, configured]);

  useEffect(() => {
    const status = snapshot?.generationJob?.status;
    if (!workflowRef.current || (status !== "queued" && status !== "processing")) return;
    const timer = setInterval(() => {
      void workflowRef.current?.resume().then(acceptServerSnapshot).catch((cause: unknown) => setError(messageForError(cause)));
    }, 3000);
    return () => clearInterval(timer);
  }, [snapshot?.generationJob?.status]);

  async function selectPhoto(view: AvatarPhotoView) {
    setError("");
    setNotice("");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Photo library access is needed to choose avatar photos. You can enable it in device settings.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        base64: true,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri || !asset.base64) {
        setError("The selected photo could not be read. Choose another image.");
        return;
      }

      const contentType = resolveContentType(asset.mimeType, asset.fileName);
      if (!contentType) {
        setError("Choose a JPEG, PNG, or WebP image.");
        return;
      }
      const byteSize = asset.fileSize ?? estimateBase64Size(asset.base64);
      if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_PHOTO_BYTES) {
        setError("Each photo must be smaller than 10 MB.");
        return;
      }
      const sha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        asset.base64,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
      setSelected((current) => ({
        ...current,
        [view]: {
          uri: asset.uri,
          fileName: asset.fileName || `${view}.${extension}`,
          contentType,
          byteSize,
          sha256,
        },
      }));
    } catch {
      setError("The photo library could not be opened. Please try again.");
    }
  }

  async function refreshStatus() {
    const workflow = workflowRef.current;
    if (!workflow || submitLock.current) return;
    setLoadingAvatar(true);
    setError("");
    try {
      acceptServerSnapshot(await workflow.resume());
      setNotice("Upload status refreshed from the server.");
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setLoadingAvatar(false);
    }
  }

  async function uploadPhotos() {
    const workflow = workflowRef.current;
    if (!workflow || !snapshot || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const currentSnapshot = await workflow.resume();
      acceptServerSnapshot(currentSnapshot);
      await workflow.uploadSelected(currentSnapshot, selected, (view) => {
        setUploadingView(view);
      }, (photo) => {
        setUploadingView(null);
        setSnapshot((current) => {
          if (!current || current.avatar.id !== photo.avatarId) return current;
          if (current.photos.some((existing) => existing.view === photo.view)) return current;
          return { ...current, photos: [...current.photos, photo] };
        });
        setSelected((current) => {
          const next = { ...current };
          delete next[photo.view];
          return next;
        });
      });
      const refreshed = await workflow.resume();
      acceptServerSnapshot(refreshed);
      setNotice("All four photo views are uploaded. Avatar generation has not started.");
    } catch (cause) {
      if (cause instanceof MissingPhotoViewsError) {
        setError(`Select a photo for each remaining view: ${cause.missingViews.map((view) => VIEW_LABELS[view]).join(", ")}.`);
      } else {
        setError(messageForError(cause));
      }
    } finally {
      submitLock.current = false;
      setSubmitting(false);
      setUploadingView(null);
    }
  }

  async function generateAvatar() {
    const workflow = workflowRef.current;
    if (!workflow || !snapshot || generationBusy) return;
    setGenerationBusy(true);
    setError("");
    setNotice("");
    try {
      acceptServerSnapshot(await workflow.startGeneration(snapshot));
      setNotice("Avatar generation has started. This screen will update when the result is ready.");
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setGenerationBusy(false);
    }
  }

  if (authLoading) {
    return <CenteredState label="Checking your session..." />;
  }
  if (!configured) {
    return <CenteredState loading={false} label="Authentication is not configured. Set the public Supabase URL and publishable key, then restart the app." />;
  }
  if (!session) {
    return <SignInForm signIn={signIn} signUp={signUp} />;
  }

  const uploadedViews = new Set(snapshot?.photos.map((photo) => photo.view) ?? []);
  const complete = PHOTO_VIEWS.every((view) => uploadedViews.has(view));
  const readyToUpload = PHOTO_VIEWS.every(
    (view) => uploadedViews.has(view) || Boolean(selected[view])
  );

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Avatar photos</Text>
          <Text style={styles.subtitle}>Four views, uploaded securely</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut().catch(() => setError("Sign-out failed. Please try again."))}
        >
          <Text style={styles.textAction}>Sign out</Text>
        </Pressable>
      </View>

      {snapshot ? (
        <Text style={styles.avatarId}>Avatar | {snapshot.avatar.id.slice(0, 8)}</Text>
      ) : null}

      {PHOTO_VIEWS.map((view) => {
        const uploaded = uploadedViews.has(view);
        const photo = selected[view];
        const active = uploadingView === view;
        return (
          <Card key={view} style={styles.photoRow}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.preview} accessibilityLabel={`${VIEW_LABELS[view]} photo preview`} />
            ) : (
              <View style={styles.emptyPreview}>
                <Text style={styles.emptyInitial}>{VIEW_LABELS[view].slice(0, 1)}</Text>
              </View>
            )}
            <View style={styles.photoDetails}>
              <Text style={styles.viewName}>{VIEW_LABELS[view]}</Text>
              <Text style={styles.photoState}>
                {uploaded ? "Uploaded and confirmed" : photo ? `${formatBytes(photo.byteSize)} - Ready` : "Photo required"}
              </Text>
              {!uploaded ? (
                <Button
                  title={photo ? "Replace photo" : "Choose photo"}
                  disabled={submitting || loadingAvatar || active}
                  onPress={() => void selectPhoto(view)}
                />
              ) : null}
            </View>
            {active ? <ActivityIndicator color={colors.primary} accessibilityLabel="Uploading photo" /> : null}
          </Card>
        );
      })}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}

      {loadingAvatar ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading avatar upload status" />
      ) : snapshot ? (
        complete ? (
          <Card style={styles.completion}>
            <Text style={styles.completionTitle}>All photo views uploaded</Text>
            {snapshot.generationJob ? (
              <>
                <Text style={styles.body}>
                  Generation status: {snapshot.generationJob.status}{snapshot.generationJob.progress !== null ? ` (${snapshot.generationJob.progress}%)` : ""}
                </Text>
                {snapshot.generatedAsset ? <Image source={{ uri: snapshot.generatedAsset.url }} style={styles.generatedPreview} accessibilityLabel="Generated avatar result" /> : null}
              </>
            ) : (
              <>
                <Text style={styles.body}>The server confirmed all four photos. Start the configured avatar generation provider when ready.</Text>
                <Button title={generationBusy ? "Starting generation..." : "Generate my avatar"} disabled={generationBusy} onPress={() => void generateAvatar()} />
              </>
            )}
          </Card>
        ) : (
          <Button
            title={submitting ? `Uploading${uploadingView ? ` ${VIEW_LABELS[uploadingView].toLowerCase()}` : ""}...` : "Upload selected photos"}
            disabled={!readyToUpload || submitting}
            onPress={() => void uploadPhotos()}
          />
        )
      ) : (
        <Button title="Retry loading avatar" disabled={loadingAvatar} onPress={() => void refreshStatus()} />
      )}

      {snapshot && !complete ? (
        <Button title="Refresh upload status" disabled={submitting || loadingAvatar} onPress={() => void refreshStatus()} />
      ) : null}
      <Text style={styles.privacy}>Photos are sent to your configured Runway API. Selection alone does not upload them.</Text>
    </ScrollView>
  );
}

function SignInForm({
  signIn,
  signUp,
}: {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
}) {
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit() {
    setError("");
    setNotice("");
    if (!email.trim() || password.length < 8) {
      setError("Enter a valid email and a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (createAccount) {
        const confirmationRequired = await signUp(email.trim(), password);
        if (confirmationRequired) setNotice("Check your email to confirm the account, then sign in.");
      } else {
        await signIn(email.trim(), password);
      }
    } catch (cause) {
      setError(cause instanceof MobileAuthError ? cause.message : "Authentication failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.authScreen} keyboardShouldPersistTaps="handled">
      <Card style={styles.authCard}>
        <Text style={styles.title}>{createAccount ? "Create account" : "Sign in"}</Text>
        <Text style={styles.body}>Sign in securely to save avatar photos to your account.</Text>
        <Input
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email address"
          textContentType="emailAddress"
          value={email}
        />
        <Input
          accessibilityLabel="Password"
          autoCapitalize="none"
          autoComplete={createAccount ? "new-password" : "current-password"}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          textContentType={createAccount ? "newPassword" : "password"}
          value={password}
        />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        <Button
          title={busy ? "Please wait..." : createAccount ? "Create account" : "Sign in"}
          disabled={busy}
          onPress={() => void submit()}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setCreateAccount((current) => !current);
            setError("");
            setNotice("");
          }}
          style={styles.modeToggle}
        >
          <Text style={styles.textAction}>
            {createAccount ? "Already have an account? Sign in" : "New to Runway Style? Create an account"}
          </Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

function CenteredState({ label, loading = true }: { label: string; loading?: boolean }) {
  return (
    <View style={styles.centered}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}

function resolveContentType(mimeType: string | null | undefined, fileName: string | null | undefined): AvatarPhotoContentType | null {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
    return normalized;
  }
  if (!normalized && fileName) {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
  }
  return null;
}

function estimateBase64Size(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function messageForError(error: unknown): string {
  if (error instanceof AvatarApiClientError) return error.message;
  if (error instanceof MissingPhotoViewsError) return "Select a photo for every remaining view.";
  return "Could not load or upload avatar photos. Check your connection and retry.";
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  authScreen: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  authCard: { gap: spacing.md },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: { color: colors.foreground, fontSize: 26, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: spacing.xs },
  avatarId: { color: colors.muted, fontSize: 13 },
  photoRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  preview: { width: 76, height: 92, borderRadius: 8, backgroundColor: "#F2F3F5" },
  generatedPreview: { width: "100%", height: 320, borderRadius: 12, backgroundColor: "#F2F3F5" },
  emptyPreview: {
    width: 76,
    height: 92,
    borderRadius: 8,
    backgroundColor: "#F2F3F5",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyInitial: { color: colors.muted, fontSize: 26, fontWeight: "600" },
  photoDetails: { flex: 1, gap: spacing.xs },
  viewName: { color: colors.foreground, fontSize: 17, fontWeight: "600" },
  photoState: { color: colors.muted, fontSize: 13 },
  textAction: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  modeToggle: { alignItems: "center", paddingVertical: spacing.sm },
  error: { color: "#B42318", fontSize: 14, lineHeight: 20 },
  notice: { color: "#18794E", fontSize: 14, lineHeight: 20 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  completion: { borderRadius: 12, gap: spacing.sm },
  completionTitle: { color: colors.foreground, fontSize: 18, fontWeight: "700" },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  centered: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
});