import "react-native-url-polyfill/auto";

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

type MobileExtra = {
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as MobileExtra;

export const mobileConfig = {
  apiBaseUrl: extra.apiBaseUrl?.trim() ?? "",
  supabaseUrl: extra.supabaseUrl?.trim() ?? "",
  supabasePublishableKey: extra.supabasePublishableKey?.trim() ?? "",
};

const webStorage = {
  async getItem(key: string): Promise<string | null> {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  },
};

const authStorage = Platform.OS === "web" ? webStorage : {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export const supabase =
  mobileConfig.supabaseUrl && mobileConfig.supabasePublishableKey
    ? createClient(mobileConfig.supabaseUrl, mobileConfig.supabasePublishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: Platform.OS === "web",
          persistSession: true,
          storage: authStorage,
        },
      })
    : null;