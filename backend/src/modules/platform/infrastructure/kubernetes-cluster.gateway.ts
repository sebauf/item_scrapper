import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:https';
import { ClusterGateway, DeployedComponent } from '../application/ports/cluster.gateway';
import {
  KubeDeployment,
  KubePod,
  labelSelectorOf,
  toDeployedComponent,
} from './kubernetes.mapper';

/**
 * Deployments que l'interface peut mettre à jour. MongoDB et Postgres n'y
 * figurent pas : ce sont des images tierces à version figée, et les
 * redémarrer couperait l'application pour rien.
 *
 * Doit rester aligné sur les `resourceNames` de k8s/base/backend-rbac.yaml :
 * le ServiceAccount du backend n'a le droit de toucher qu'à ceux-là.
 */
export const MANAGED_DEPLOYMENTS = [
  'price-tracker-frontend',
  'price-tracker-mcp',
  'airflow-webserver',
  'airflow-scheduler',
  // En dernier : le backend se redémarre lui-même.
  'price-tracker-backend',
] as const;

/** Identité montée automatiquement dans chaque Pod par Kubernetes. */
const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

const REQUEST_TIMEOUT_MS = 5_000;

interface KubeResponse {
  status: number;
  body: string;
}

class KubeApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
    body: string,
  ) {
    super(`API Kubernetes ${path} → HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Adaptateur vers l'API Kubernetes, appelée directement en HTTPS avec le
 * jeton du ServiceAccount — pas de client officiel : trois appels ne
 * justifient pas une dépendance de plusieurs mégaoctets.
 *
 * `node:https` plutôt que `fetch` : l'API présente un certificat signé par la
 * CA du cluster, que seule l'option `ca` de https permet de fournir.
 */
@Injectable()
export class KubernetesClusterGateway extends ClusterGateway {
  isAvailable(): boolean {
    return Boolean(process.env.KUBERNETES_SERVICE_HOST) && existsSync(`${SERVICE_ACCOUNT_DIR}/token`);
  }

  async listComponents(): Promise<DeployedComponent[]> {
    const namespace = this.namespace();
    const components = await Promise.all(
      MANAGED_DEPLOYMENTS.map(async (name) => {
        const deployment = await this.getJson<KubeDeployment>(
          `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
          { allowNotFound: true },
        );
        // Un composant non déployé (ex. MCP retiré de l'overlay) n'est pas une erreur.
        if (deployment === null) return null;

        const pods = await this.getJson<{ items: KubePod[] }>(
          `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelectorOf(deployment))}`,
        );
        return toDeployedComponent(deployment, pods?.items ?? []);
      }),
    );
    return components.filter((component) => component !== null);
  }

  async restart(names: readonly string[]): Promise<void> {
    const namespace = this.namespace();
    // Exactement ce que fait `kubectl rollout restart` : modifier une
    // annotation du template suffit à ce que le contrôleur recrée les Pods.
    const patch = JSON.stringify({
      spec: {
        template: {
          metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } },
        },
      },
    });

    // Séquentiel et dans l'ordre de MANAGED_DEPLOYMENTS : le backend en dernier.
    const ordered = MANAGED_DEPLOYMENTS.filter((name) => names.includes(name));
    for (const name of ordered) {
      const path = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;
      const response = await this.send('PATCH', path, patch, 'application/strategic-merge-patch+json');
      if (response.status >= 300) throw new KubeApiError(response.status, path, response.body);
    }
  }

  private namespace(): string {
    return readFileSync(`${SERVICE_ACCOUNT_DIR}/namespace`, 'utf8').trim();
  }

  private async getJson<T>(path: string, options: { allowNotFound?: boolean } = {}): Promise<T | null> {
    const response = await this.send('GET', path);
    if (response.status === 404 && options.allowNotFound) return null;
    if (response.status >= 300) throw new KubeApiError(response.status, path, response.body);
    return JSON.parse(response.body) as T;
  }

  private send(method: string, path: string, body?: string, contentType?: string): Promise<KubeResponse> {
    // Relu à chaque appel : le jeton projeté est renouvelé périodiquement par le kubelet.
    const token = readFileSync(`${SERVICE_ACCOUNT_DIR}/token`, 'utf8').trim();
    const ca = readFileSync(`${SERVICE_ACCOUNT_DIR}/ca.crt`);

    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: process.env.KUBERNETES_SERVICE_HOST,
          port: process.env.KUBERNETES_SERVICE_PORT ?? 443,
          path,
          method,
          ca,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(contentType ? { 'content-type': contentType } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error(`API Kubernetes ${path} : délai dépassé`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
