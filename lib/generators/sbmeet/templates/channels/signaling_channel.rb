class SignalingChannel < ApplicationCable::Channel
  def subscribed
    stream_from "signaling_room_#{params[:room_id]}"
  end

  def receive(data)
    # Inject authenticated current_user context directly into outbound payloads
    data[:user_id] = current_user.id
    data[:user_name] = current_user.email.split('@').first.capitalize
    
    ActionCable.server.broadcast("signaling_room_#{data['room_id']}", data)
  end
end
