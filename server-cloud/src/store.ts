export class PlansStore {
  private state: DurableObjectState;
  private plans: Map<string, any>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.plans = new Map();
  }

  async initialize() {
    // Load stored data
    const stored = await this.state.storage.get('plans') || {};
    this.plans = new Map(Object.entries(stored));
  }

  private jsonResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async fetch(request: Request) {
    await this.initialize();
    
    const url = new URL(request.url);
    const paths = url.pathname.split('/').filter(Boolean);
    const isApiPath = paths[0] === 'api';
    const isPlansPath = paths[1] === 'plans';
    const id = paths[2];

    if (!isApiPath || !isPlansPath) {
      return this.jsonResponse({ error: 'Invalid path' }, 404);
    }

    try {
      switch (request.method) {
        case 'GET':
          if (!id) {
            // List all plans
            const plans = Array.from(this.plans.entries()).map(([id, plan]) => ({
              id,
              ...plan
            }));
            return this.jsonResponse(plans);
          }
          // Get single plan
          const plan = this.plans.get(id);
          if (!plan) {
            return this.jsonResponse({ error: 'Plan not found' }, 404);
          }
          return this.jsonResponse({ id, ...plan });

        case 'POST':
          if (id) {
            return this.jsonResponse({ error: 'Invalid path for POST request' }, 400);
          }
          const newPlan = await request.json();
          if (!newPlan || typeof newPlan !== 'object' || Array.isArray(newPlan)) {
            return this.jsonResponse({ error: 'Invalid plan data' }, 400);
          }
          
          const newId = crypto.randomUUID();
          const planData = {
            ...newPlan,
            created_at: new Date().toISOString()
          };
          
          this.plans.set(newId, planData);
          await this.state.storage.put('plans', Object.fromEntries(this.plans));
          return this.jsonResponse({ id: newId, ...planData }, 201);

        case 'PATCH':
          if (!id) {
            return this.jsonResponse({ error: 'Plan ID is required' }, 400);
          }
          
          const updates = await request.json();
          if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            return this.jsonResponse({ error: 'Invalid update data' }, 400);
          }

          const existingPlan = this.plans.get(id);
          if (!existingPlan) {
            return this.jsonResponse({ error: 'Plan not found' }, 404);
          }

          const updatedPlan = {
            ...existingPlan,
            ...updates,
            updated_at: new Date().toISOString()
          };
          
          this.plans.set(id, updatedPlan);
          await this.state.storage.put('plans', Object.fromEntries(this.plans));
          return this.jsonResponse({ id, ...updatedPlan });

        case 'DELETE':
          if (!id) {
            return this.jsonResponse({ error: 'Plan ID is required' }, 400);
          }

          if (!this.plans.has(id)) {
            return this.jsonResponse({ error: 'Plan not found' }, 404);
          }

          this.plans.delete(id);
          await this.state.storage.put('plans', Object.fromEntries(this.plans));
          return this.jsonResponse({ success: true });

        default:
          return this.jsonResponse({ error: 'Method not allowed' }, 405);
      }
    } catch (error) {
      console.error('Error in PlansStore:', error);
      return this.jsonResponse({ error: 'Internal server error' }, 500);
    }
  }
}